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

// Parse current data to get just titles for a slim context
let currentTitles = '';
try {
  const parsed = JSON.parse(currentData);
  const allTitles = [
    ...(parsed.scholarships || []).map(s => s.title),
    ...(parsed.internships || []).map(s => s.title),
    ...(parsed.universityPrograms || []).map(s => s.title),
  ];
  currentTitles = allTitles.join(', ');
} catch(e) {
  currentTitles = 'none yet';
}

// Helper: sleep for ms milliseconds
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Helper: call API with retry on rate limit
async function callAPI(body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (response.status === 429) {
      const wait = (i + 1) * 65000; // 65s, 130s, 195s
      console.log(`Rate limited — waiting ${wait/1000}s before retry ${i+1}/${retries}...`);
      await sleep(wait);
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      console.error('API error:', err);
      process.exit(1);
    }

    return response.json();
  }
  console.error('Max retries exceeded');
  process.exit(1);
}

console.log('Step 1: Searching the web for scholarship updates...');

// Step 1 — Search with a slim prompt to stay under token limits
const searchData = await callAPI({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2000,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  system: 'You research local scholarships. Search the web and summarize findings briefly.',
  messages: [{
    role: 'user',
    content: `Today is ${new Date().toISOString().split('T')[0]}.

Search for 2026 scholarship and internship updates near Phoenixville PA 19460 Chester County.
Focus on: deadline changes, new scholarships, new internships.
Existing programs: ${currentTitles}

Give a brief factual summary only.`
  }]
});

const searchSummary = searchData.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

console.log('Step 2: Converting to JSON...');
await sleep(5000); // Small pause between calls

// Step 2 — Convert to JSON using slim current data
const jsonData = await callAPI({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 6000,
  system: `Convert scholarship data to JSON. Output ONLY valid JSON starting with {. No explanation.`,
  messages: [{
    role: 'user',
    content: `Current data (update this):
${currentData}

New findings:
${searchSummary}

Output the updated JSON with structure:
{"lastUpdated":"${new Date().toISOString().split('T')[0]}","scholarships":[...],"internships":[...],"universityPrograms":[...]}

Each item needs: id, title, amount, category, desc, eligibility, deadline, how, source, url
Start with { immediately.`
  }]
});

const rawText = jsonData.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('');

let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

const firstBrace = cleaned.indexOf('{');
const lastBrace = cleaned.lastIndexOf('}');

if (firstBrace === -1 || lastBrace === -1) {
  console.error('No JSON found in response');
  console.error('Raw:', cleaned.substring(0, 300));
  process.exit(1);
}

cleaned = cleaned.substring(firstBrace, lastBrace + 1);

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch(e) {
  console.error('Invalid JSON:', e.message);
  console.error('Raw:', cleaned.substring(0, 500));
  process.exit(1);
}

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2));
console.log('Done:', {
  scholarships: parsed.scholarships?.length ?? 0,
  internships: parsed.internships?.length ?? 0,
  universityPrograms: parsed.universityPrograms?.length ?? 0
});
