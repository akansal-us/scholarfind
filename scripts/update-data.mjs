import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const DATA_FILE = path.join(process.cwd(), 'data', 'scholarships.json');

// Load current data so AI can compare
const currentData = fs.existsSync(DATA_FILE)
  ? fs.readFileSync(DATA_FILE, 'utf8')
  : '{}';

console.log('Calling Claude with web search to check for updates...');

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'interleaved-thinking-2025-05-14'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search'
      }
    ],
    system: `You are a data updater for a local scholarship website serving Phoenixville PA 19460 (ZIP code).
Your job is to search the web and return an updated JSON data object with current information.

IMPORTANT RULES:
- Only return a single valid JSON object — no markdown, no backticks, no explanation
- Keep all existing entries unless you find clear evidence they are discontinued
- Update deadline dates, amounts if you find newer info
- Add new legitimate programs you find for Chester County / Phoenixville area
- Flag any entry as "needsReview": true if you are uncertain about it
- Keep the same JSON structure as the current data

The JSON structure is:
{
  "lastUpdated": "YYYY-MM-DD",
  "scholarships": [ ...array of scholarship objects... ],
  "internships": [ ...array of internship objects... ],
  "universityPrograms": [ ...array of program objects... ]
}

Each item has: id, title, amount, category, desc, eligibility, deadline, how, source, url`,
    messages: [
      {
        role: 'user',
        content: `Today is ${new Date().toISOString().split('T')[0]}.

Here is the current scholarship data for the site:
${currentData}

Please search the web for:
1. Any updates to existing scholarships/deadlines near Phoenixville PA 19460
2. New scholarships for Chester County high school students for 2026
3. New internship programs within 15 miles of Phoenixville PA
4. Any university programs for middle/high schoolers in the Philadelphia region

Return the complete updated JSON object only.`
      }
    ]
  })
});

if (!response.ok) {
  const err = await response.text();
  console.error('API error:', err);
  process.exit(1);
}

const data = await response.json();

// Extract text from response (may include tool use blocks)
const textBlocks = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

// Strip any accidental markdown fences
const cleaned = textBlocks.replace(/```json|```/g, '').trim();

// Validate JSON before writing
let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch (e) {
  console.error('AI did not return valid JSON:', e.message);
  console.error('Raw output:', cleaned.substring(0, 500));
  process.exit(1);
}

// Write to data file
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2));
console.log('Data updated successfully. Items:', {
  scholarships: parsed.scholarships?.length ?? 0,
  internships: parsed.internships?.length ?? 0,
  universityPrograms: parsed.universityPrograms?.length ?? 0
});
