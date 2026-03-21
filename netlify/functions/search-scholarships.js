exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { zip } = JSON.parse(event.body || '{}');
  if (!zip) return { statusCode: 400, body: 'ZIP required' };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, body: 'API key not configured' };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'You find local scholarships for students. Return ONLY a valid JSON array of up to 6 scholarships. Each object must have: title, amount, desc, eligibility, deadline, url. No markdown, no backticks, no explanation — just the raw JSON array.',
        messages: [{ role: 'user', content: 'Find real local scholarships for high school students near ZIP code ' + zip + ' in Chester County Pennsylvania for 2026. Search the web. Return JSON array only.' }]
      })
    });

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let items = [];
    try { items = JSON.parse(clean); } catch(e) { items = []; }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
