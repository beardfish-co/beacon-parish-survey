export const config = { api: { bodyParser: { sizeLimit: '26mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured in Vercel environment variables' });

  const { audioBase64, mimeType, fileName, parishName } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: 'No audio data provided' });

  try {
    // ── 1. Transcribe with Whisper ────────────────────────────────────────────
    const buffer = Buffer.from(audioBase64, 'base64');
    const blob = new Blob([buffer], { type: mimeType || 'audio/mpeg' });

    const formData = new FormData();
    formData.append('file', blob, fileName || 'interview.mp3');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.json().catch(() => ({}));
      return res.status(500).json({ error: 'Whisper transcription failed', detail: err });
    }

    const { text: transcript } = await whisperRes.json();

    // ── 2. Extract Q1–Q4 with GPT-4o-mini ────────────────────────────────────
    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are helping record parish interview responses for the Divine Renovation Beacon Event (March 2027), a peer-learning gathering of Australian Catholic parishes.

Extract answers to these four questions from the interview transcript:
Q1 – Felt Needs: "What topics would you most want to learn from other key missional parishes around the country?"
Q2 – Your Strengths: "What do you think is going really well in your parish right now that might be of real interest to others?"
Q3 – Current Challenges: "What's not going as well as you'd like — that you'd love to see what other parishes are doing in that area?"
Q4 – Future Dreams: "In the next 2–3 years, what are you dreaming about that you'd love to get input on from brother priests?"

Rules:
- Write responses in third person from the parish's perspective (e.g. "Fr John noted that…")
- Be concise but capture the key substance
- If a question was not clearly addressed, return an empty string
- Put tone observations, follow-up items, or anything that doesn't fit Q1–Q4 in notes

Return ONLY valid JSON with keys: q1, q2, q3, q4, notes`,
          },
          {
            role: 'user',
            content: `Parish: ${parishName || 'Unknown'}\n\nTranscript:\n${transcript}`,
          },
        ],
      }),
    });

    if (!extractRes.ok) {
      // Return transcript even if extraction fails — user can still read it
      return res.json({ transcript, q1: '', q2: '', q3: '', q4: '', notes: '', extractError: true });
    }

    const extractData = await extractRes.json();
    const extracted = JSON.parse(extractData.choices[0].message.content);

    return res.json({ transcript, ...extracted });
  } catch (err) {
    console.error('Transcription error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
