import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const DATA_FILE = path.join(process.cwd(), 'data', 'scholarships.json');

const currentData = fs.existsSync(DATA_FILE)
  ? fs.readFileSync(DATA_FILE, 'utf8')
  : '{}';

console.log('Calling Claude with web search to check for updates...');

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: `You are a JSON data updater. You MUST respond with ONLY a valid JSON object — nothing else.
No preamble. No explanation. No markdown. No backticks. No text before or after the JSON.
Your entire response must start with { and end with }.
If you cannot comply, output exactly: {"error": "could not generate data"}

The JSON structure must be:
{
  "lastUpdated": "YYYY-MM-DD",
  "scholarships": [ ...array... ],
  "internships": [ ...array... ],
  "universityPrograms": [ ...array... ]
}

Each item has: id, title, amount, category, desc, eligibility, deadline, how, source, url`,
    messages: [{
      role: 'user',
      content: `Today is ${new Date().toISOString().split('T')[0]}.

Search the web for updates to scholarships, internships and university programs near Phoenixville PA 19460 Chester County for 2026.

Current data to update:
${currentData}

Rules:
- Keep all existing entries, just update deadlines/amounts if you find newer info
- Add new legitimate programs found for Chester County area
- Return ONLY the JSON object. Start your response with { immediately.`
    }]
  })
});

if (!response.ok) {
  const err = await response.text();
  console.error('API error:', err);
  process.exit(1);
}

const data = await response.json();

const textBlocks = data.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

let cleaned = textBlocks.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

// Extract JSON — find first { and last } to isolate the object
const firstBrace = cleaned.indexOf('{');
const lastBrace = cleaned.lastIndexOf('}');

if (firstBrace === -1 || lastBrace === -1) {
  console.error('No JSON object found in response');
  console.error('Raw output:', cleaned.substring(0, 300));
  process.exit(1);
}

cleaned = cleaned.substring(firstBrace, lastBrace + 1);

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch (e) {
  console.error('AI did not return valid JSON:', e.message);
  console.error('Raw output:', cleaned.substring(0, 500));
  process.exit(1);
}

if (parsed.error) {
  console.error('AI returned error:', parsed.error);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2));
console.log('Data updated successfully. Items:', {
  scholarships: parsed.scholarships?.length ?? 0,
  internships: parsed.internships?.length ?? 0,
  universityPrograms: parsed.universityPrograms?.length ?? 0
});
