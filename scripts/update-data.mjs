// ============================================================
// update-data.mjs — ScholarFind two-tier data updater
//
// TIER 1 (weekly): Verify existing scholarship URLs
// TIER 2 (weekly): Search for new scholarships
//
// Usage:
//   node update-data.mjs          — runs both tiers
//   node update-data.mjs --verify — Tier 1 only
//   node update-data.mjs --search — Tier 2 only
// ============================================================

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const RUN_VERIFY = !args.includes('--search');
const RUN_SEARCH = !args.includes('--verify');
const DATA_FILE = path.join(process.cwd(), 'data', 'scholarships.json');
const today = new Date().toISOString().split('T')[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Load current data
let currentData = { lastUpdated: today, scholarships: [], internships: [], universityPrograms: [] };
if (fs.existsSync(DATA_FILE)) {
  try { currentData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { console.warn('Could not parse data file — starting fresh'); }
}

// ============================================================
// HELPERS
// ============================================================
async function callAPI(body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    if (res.status === 429) {
      const wait = (i + 1) * 65000;
      console.log(`  Rate limited — waiting ${wait/1000}s...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) { console.error('  API error:', (await res.text()).substring(0, 200)); return null; }
    return res.json();
  }
  return null;
}

function getText(data) {
  if (!data) return '';
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function extractJSON(text, type = 'object') {
  const c = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const [open, close] = type === 'array' ? ['[', ']'] : ['{', '}'];
  const start = c.indexOf(open), end = c.lastIndexOf(close);
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(c.substring(start, end + 1)); } catch(e) { return null; }
}

// ============================================================
// TIER 1 — VERIFY EXISTING URLS
// ============================================================
async function verifyItem(item) {
  if (!item.url || !item.title) return item;

  // Skip if verified recently
  if (item.lastVerified) {
    const daysSince = Math.floor((new Date() - new Date(item.lastVerified)) / 86400000);
    if (daysSince < 6) { console.log(`  ⏭️  ${item.title} — verified ${daysSince}d ago`); return item; }
  }

  // Skip aggregator URLs — they don't have reliable deadline info
  const skipDomains = ['chescocf.org', 'philafound.org', 'fastweb.com', 'scholarships.com'];
  if (skipDomains.some(d => item.url.includes(d))) {
    console.log(`  ⏭️  ${item.title} — aggregator URL, skipping`);
    return { ...item, lastVerified: today };
  }

  console.log(`  🔍 Verifying: ${item.title}`);
  try {
    const pageRes = await fetch(item.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScholarFind/1.0)' },
      signal: AbortSignal.timeout(10000)
    });

    if (!pageRes.ok) {
      console.log(`    ⚠️  URL returned ${pageRes.status}`);
      return { ...item, lastVerified: today, needsReview: true, reviewReason: `URL returned ${pageRes.status}` };
    }

    const html = await pageRes.text();
    const pageText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 3000);

    await sleep(2000);
    const data = await callAPI({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'Compare scholarship details against webpage content. Return ONLY JSON: {"changed":bool,"deadline":string|null,"amount":string|null,"active":bool,"notes":string}. Start with {',
      messages: [{
        role: 'user',
        content: `Scholarship: "${item.title}"
Our deadline: ${item.deadline}
Our amount: ${item.amount}
Webpage: ${pageText}
Is it still active? Has deadline or amount changed? Return JSON only.`
      }]
    });

    const result = extractJSON(getText(data));
    if (!result) { console.log('    ⚠️  Could not parse response'); return { ...item, lastVerified: today }; }

    if (!result.active) {
      console.log(`    ❌ Possibly inactive: ${result.notes}`);
      return { ...item, lastVerified: today, needsReview: true, reviewReason: `Possibly inactive: ${result.notes}` };
    }

    if (result.changed) {
      const updated = { ...item, lastVerified: today, needsReview: false };
      if (result.deadline) { console.log(`    📅 ${item.deadline} → ${result.deadline}`); updated.deadline = result.deadline; }
      if (result.amount) { console.log(`    💰 ${item.amount} → ${result.amount}`); updated.amount = result.amount; }
      if (result.notes) console.log(`    📝 ${result.notes}`);
      return updated;
    }

    console.log(`    ✅ No changes`);
    return { ...item, lastVerified: today, needsReview: false };

  } catch(e) {
    console.log(`    ⚠️  Fetch failed: ${e.message.substring(0, 60)}`);
    return { ...item, lastVerified: today, needsReview: true, reviewReason: `Fetch failed: ${e.message.substring(0, 60)}` };
  }
}

async function runVerification() {
  console.log('\n📋 TIER 1 — Verifying existing entries...\n');

  const allItems = [
    ...currentData.scholarships.map(s => ({ ...s, _type: 'scholarships' })),
    ...currentData.internships.map(s => ({ ...s, _type: 'internships' })),
    ...currentData.universityPrograms.map(s => ({ ...s, _type: 'universityPrograms' })),
  ].filter(s => s.url);

  const batch = allItems.slice(0, 10); // max 10 per run
  console.log(`  Verifying ${batch.length} of ${allItems.length} items`);

  const updatedMap = {};
  for (const item of batch) {
    const updated = await verifyItem(item);
    updatedMap[item.id] = updated;
    await sleep(1500);
  }

  for (const type of ['scholarships', 'internships', 'universityPrograms']) {
    currentData[type] = currentData[type].map(item => {
      if (updatedMap[item.id]) { const { _type, ...clean } = updatedMap[item.id]; return clean; }
      return item;
    });
  }

  const needsReview = Object.values(updatedMap).filter(i => i.needsReview).length;
  console.log(`\n  Done: ${batch.length} verified, ${needsReview} need review`);
}

// ============================================================
// TIER 2 — SEARCH FOR NEW SCHOLARSHIPS
// ============================================================
async function runSearch() {
  console.log('\n🔍 TIER 2 — Searching for new opportunities...\n');

  const existingTitles = [
    ...currentData.scholarships.map(s => s.title),
    ...currentData.internships.map(s => s.title),
    ...currentData.universityPrograms.map(s => s.title),
  ];

  console.log('  Step 1: Web search...');
  const searchData = await callAPI({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: 'Research local scholarships and programs. Summarize new findings briefly and factually.',
    messages: [{
      role: 'user',
      content: `Today is ${today}. Search for NEW scholarships, internships, and university programs for students near Phoenixville PA 19460 / Chester County for 2026-2027.

We already have: ${existingTitles.slice(0,20).join(', ')}

Find programs we are missing. Brief summary only.`
    }]
  });

  const summary = getText(searchData);
  if (!summary) { console.log('  No search results'); return; }

  console.log('  Step 2: Extracting new items...');
  await sleep(5000);

  const jsonData = await callAPI({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system: 'Extract scholarship data into JSON. Return ONLY a JSON array of new items. Start with [',
    messages: [{
      role: 'user',
      content: `From this research, extract genuinely NEW items not in our database.

Research: ${summary}

Already have: ${existingTitles.slice(0,20).join(', ')}

Return JSON array. Each item needs: id (new_shortname), title, amount, category, desc, eligibility, deadline, how, source, url, type (scholarship/internship/university).
If nothing new, return []. Start with [`
    }]
  });

  const newItems = extractJSON(getText(jsonData), 'array');
  if (!newItems || newItems.length === 0) { console.log('  ✅ No new items found'); return; }

  let added = 0;
  for (const item of newItems) {
    if (!item.title || !item.url) continue;
    const isDupe = existingTitles.some(t =>
      t.toLowerCase().includes(item.title.toLowerCase().substring(0,15)) ||
      item.title.toLowerCase().includes(t.toLowerCase().substring(0,15))
    );
    if (isDupe) { console.log(`  ⏭️  Duplicate: ${item.title}`); continue; }

    const { type, ...rest } = item;
    rest.lastVerified = today;
    rest.needsReview = true;
    rest.reviewReason = 'New — please verify before publishing';

    if (type === 'internship') currentData.internships.push(rest);
    else if (type === 'university') currentData.universityPrograms.push(rest);
    else currentData.scholarships.push(rest);

    console.log(`  ➕ Added (needs review): ${item.title}`);
    added++;
  }
  console.log(`\n  Done: ${added} new items added`);
}

// ============================================================
// MAIN
// ============================================================
console.log(`\n🎓 ScholarFind Updater — ${today}`);
console.log(`   Mode: ${RUN_VERIFY ? 'Verify' : ''}${RUN_VERIFY && RUN_SEARCH ? ' + ' : ''}${RUN_SEARCH ? 'Search' : ''}`);

if (RUN_VERIFY) await runVerification();
if (RUN_SEARCH) await runSearch();

currentData.lastUpdated = today;
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(currentData, null, 2));

const needsReview = [...currentData.scholarships, ...currentData.internships, ...currentData.universityPrograms].filter(s => s.needsReview);
console.log(`\n✅ Done — ${currentData.scholarships.length} scholarships | ${currentData.internships.length} internships | ${currentData.universityPrograms.length} programs`);
if (needsReview.length) {
  console.log(`⚠️  ${needsReview.length} items need your review:`);
  needsReview.forEach(s => console.log(`   - ${s.title}: ${s.reviewReason || ''}`));
}
