export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { parishes } = req.body || {};
  if (!parishes || !parishes.length) return res.status(400).json({ error: 'No parish data provided' });

  const withResponses = parishes.filter(p => p.q1 || p.q2 || p.q3 || p.q4);
  if (!withResponses.length) return res.status(400).json({ error: 'No responses to summarise yet' });

  const parishData = withResponses.map(p => ({
    parish: p.name,
    priest: p.priest,
    q1: p.q1 || '',
    q2: p.q2 || '',
    q3: p.q3 || '',
    q4: p.q4 || '',
  }));

  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are preparing an executive briefing for Brent Delfo, who is designing the agenda for the Divine Renovation Beacon Event (March 2027) — a peer-learning gathering of Australian Catholic parishes.

Your task: synthesise pre-event survey responses from ${withResponses.length} parishes across four questions. Identify the dominant themes and patterns. Write in clear, agenda-ready prose — Brent should be able to read this and immediately understand what matters most to these parishes and what the event agenda should address.

The four survey questions:
Q1 – Felt Needs: "What topics would you most want to learn from other key missional parishes?"
Q2 – Your Strengths: "What is going really well that might be of real interest to others?"
Q3 – Current Challenges: "What's not going as well as you'd like?"
Q4 – Future Dreams: "What are you dreaming about for the next 2–3 years?"

Return ONLY valid JSON with these keys:
- q1: 3–5 sentences identifying the main themes parishes want to learn about. Mention specific topics where multiple parishes raised the same thing.
- q2: 3–5 sentences on the strengths parishes are confident to share with others.
- q3: 3–5 sentences on the most common challenges. Be specific about what is struggling.
- q4: 3–5 sentences on the shared future aspirations and dreams.
- overall: 2–3 sentences — the overarching narrative across all four questions. What does this cohort most need from the Beacon Event?`,
          },
          {
            role: 'user',
            content: `Parish responses (${withResponses.length} parishes):\n${JSON.stringify(parishData, null, 2)}`,
          },
        ],
      }),
    });

    if (!gptRes.ok) {
      const err = await gptRes.json().catch(() => ({}));
      return res.status(500).json({ error: 'GPT request failed', detail: err });
    }

    const gptData = await gptRes.json();
    const summary = JSON.parse(gptData.choices[0].message.content);
    return res.json({ ...summary, parish_count: withResponses.length });
  } catch (err) {
    console.error('Summary error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
