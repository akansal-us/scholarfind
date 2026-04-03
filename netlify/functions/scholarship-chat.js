// ============================================================
// scholarship-chat.js — Netlify Function
// Powers the ScholarFind AI chatbot
// Only answers from verified scholarship database
// Requires: ANTHROPIC_API_KEY in Netlify environment variables
// ============================================================

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { message, history = [], scholarshipData = {} } = JSON.parse(event.body || '{}');
  if (!message) return { statusCode: 400, body: 'Message required' };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, body: 'API key not configured' };

  // Build a compact scholarship context from the data sent by the frontend
  const scholarships = scholarshipData.scholarships || [];
  const internships = scholarshipData.internships || [];
  const universityPrograms = scholarshipData.universityPrograms || [];

  const formatItem = (s) =>
    `• ${s.title} | ${s.amount || 'Varies'} | Deadline: ${s.deadline} | ${s.category || ''} | Eligibility: ${(s.eligibility || '').substring(0, 120)} | URL: ${s.url}`;

  const context = `
SCHOLARSHIPS (${scholarships.length}):
${scholarships.map(formatItem).join('\n')}

INTERNSHIPS (${internships.length}):
${internships.map(formatItem).join('\n')}

UNIVERSITY PROGRAMS (${universityPrograms.length}):
${universityPrograms.map(s => `• ${s.title} | ${s.amount || 'Varies'} | Deadline: ${s.deadline} | Grades: ${(s.grades||[]).join(', ')} | URL: ${s.url}`).join('\n')}
`.trim();

  // Build conversation history for multi-turn
  const messages = [
    ...history.slice(-6), // keep last 6 exchanges to stay under token limits
    { role: 'user', content: message }
  ];

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
        max_tokens: 600,
        system: `You are ScholarBot, a friendly assistant for ScholarFind — a free scholarship finder for Chester County, PA students.

Your ONLY job is to help students find scholarships, internships, and university programs from the verified database below. 

RULES:
- ONLY answer using information from the database below. Never invent scholarships or deadlines.
- Keep answers concise — 2-4 sentences max, or a short list.
- When recommending a scholarship always include the deadline and URL.
- If asked something outside this database (essay help, college advice, etc.) say: "I can only help with scholarships and programs in our Chester County database. For that question, try talking to your school counselor!"
- Be warm and encouraging — many students find this process overwhelming.
- If a student mentions their grade or interests, filter recommendations accordingly.
- Always remind students to verify details directly with each organization.
- Format responses cleanly — use bullet points for lists, bold for scholarship names.

VERIFIED DATABASE:
${context}`,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('API error:', err.substring(0, 200));
      return { statusCode: 500, body: JSON.stringify({ error: 'API error' }) };
    }

    const data = await response.json();
    const reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
