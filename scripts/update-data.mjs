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

console.log('Step 1: Searching the web for scholarship updates...');

// Step 1 — Search the web with no JSON requirement
const searchResponse = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: `You research local scholarships and opportunities. Search the web and summarize what you find. Be thorough and factual.`,
    messages: [{
      role: 'user',
      content: `Today is ${new Date().toISOString().split('T')[0]}.

Search the web for current 2026 scholarships, internships, and university programs for high school students near Phoenixville PA 19460 and Chester County Pennsylvania.

Look for:
1. Updates to these existing programs: Lenfest Scholarship, PCHF Healthcare Scholarship, Chester County Community Foundation, Philadelphia Foundation, Vanguard internship, Exelon STEM Academy
2. Any new scholarships or programs added for 2026
3. Updated deadlines or amounts

Summarize everything you find clearly.`
    }]
  })
});

if (!searchResponse.ok) {
  console.error('Search API error:', await searchResponse.text());
  process.exit(1);
}

const searchData = await searchResponse.json();
const searchSummary = searchData.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

console.log('Step 2: Converting findings to JSON...');

// Step 2 — Convert the search summary to JSON (no web search, pure formatting)
const jsonResponse = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    system: `You convert scholarship research summaries into a specific JSON format.
You must output ONLY valid JSON — no preamble, no explanation, no markdown, no backticks.
Start your response with { and end with }.`,
    messages: [{
      role: 'user',
      content: `Here is the current scholarship data:
${currentData}

Here is the new research summary:
${searchSummary}

Merge the new findings into the existing data. Update deadlines and amounts where newer info was found. Add new items if found. Keep existing items that were not mentioned.

Output ONLY this JSON structure (start with { immediately):
{
  "lastUpdated": "${new Date().toISOString().split('T')[0]}",
  "scholarships": [ array of scholarship objects ],
  "internships": [ array of internship objects ],
  "universityPrograms": [ array of university program objects ]
}

Each object needs: id, title, amount, category, desc, eligibility, deadline, how, source, url`
    }]
  })
});

if (!jsonResponse.ok) {
  console.error('JSON conversion API error:', await jsonResponse.text());
  process.exit(1);
}

const jsonData = await jsonResponse.json();
const rawText = jsonData.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

// Strip any markdown fences
let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

// Extract JSON object
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
  console.error('Invalid JSON returned:', e.message);
  console.error('Raw output:', cleaned.substring(0, 500));
  process.exit(1);
}

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2));
console.log('Data updated successfully:', {
  scholarships: parsed.scholarships?.length ?? 0,
  internships: parsed.internships?.length ?? 0,
  universityPrograms: parsed.universityPrograms?.length ?? 0
});
