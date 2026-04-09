// validate-links.js
// Runs as part of GitHub Actions weekly workflow
// Three tiers: HTTP check → keyword check → LLM relevance check
//
// Place this file at: .github/scripts/validate-links.js

import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const INDEX_PATH = './index.html';

// ─────────────────────────────────────────────
// 1. EXTRACT all entries (id, title, url) from index.html
// ─────────────────────────────────────────────
function extractEntries(html) {
  const entries = [];
  // Match each scholarship/internship/university object
  const blockRe = /\{[^{}]*?id:'([^']+)'[^{}]*?title:'([^']+)'[^{}]*?url:'(https?:\/\/[^']+)'[^{}]*?\}/gs;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    entries.push({ id: m[1], title: m[2], url: m[3] });
  }
  return entries;
}

// ─────────────────────────────────────────────
// 2. TIER 1: HTTP status check
// Returns: { ok, status, redirectedTo }
// ─────────────────────────────────────────────
async function checkHttpStatus(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'ScholarFind-LinkChecker/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    return {
      ok: res.status < 400,
      status: res.status,
      finalUrl: res.url,
      redirected: res.url !== url,
    };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, finalUrl: url, redirected: false };
  }
}

// ─────────────────────────────────────────────
// 3. TIER 2: Keyword presence check
// Fetches page text and checks for title keywords
// ─────────────────────────────────────────────
async function checkKeywordPresence(url, title) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ScholarFind-LinkChecker/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    // Strip HTML tags for plain text
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

    // Build keywords from title — strip common words, use meaningful ones
    const stopWords = new Set(['the','a','an','and','or','for','of','in','to','at','by','from','with','scholarship','program','award','foundation']);
    const keywords = title.toLowerCase()
      .split(/[\s\-–—&]+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    const matchedKeywords = keywords.filter(kw => text.includes(kw));
    const matchRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;

    // Also check for generic scholarship/program signals
    const hasScholarshipSignal = /scholarship|apply|eligib|deadline|award|program|internship/.test(text);

    return {
      passed: matchRatio >= 0.4 && hasScholarshipSignal,
      matchRatio: Math.round(matchRatio * 100),
      matchedKeywords,
      missingKeywords: keywords.filter(kw => !text.includes(kw)),
      hasScholarshipSignal,
      pageTextSnippet: text.substring(0, 400),
    };
  } catch (e) {
    return { passed: false, error: e.message, matchRatio: 0 };
  }
}

// ─────────────────────────────────────────────
// 4. TIER 3: LLM relevance check (only for flagged URLs)
// Uses Claude to judge if page still matches the scholarship
// ─────────────────────────────────────────────
async function checkLLMRelevance(url, title, pageSnippet) {
  if (!ANTHROPIC_API_KEY) return { skipped: true, reason: 'No API key' };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `I'm checking if a webpage still contains information about a specific scholarship or program.

Scholarship/Program name: "${title}"
URL: ${url}
Page text snippet (first 400 chars): "${pageSnippet}"

Does this page still appear to be about or directly related to "${title}"?
Reply with exactly one of:
- YES — page clearly relates to this scholarship/program
- MAYBE — page is related but may have moved or changed
- NO — page does not appear to be about this scholarship/program
- UNCLEAR — not enough text to judge

Then one sentence explaining why.`,
        }],
      }),
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text?.trim() || 'UNCLEAR';
    const verdict = reply.split('—')[0].trim().split('\n')[0].trim();

    return {
      verdict,         // YES / MAYBE / NO / UNCLEAR
      explanation: reply,
      passed: verdict === 'YES' || verdict === 'MAYBE',
    };
  } catch (e) {
    return { skipped: true, reason: e.message };
  }
}

// ─────────────────────────────────────────────
// 5. MAIN — run all checks and build report
// ─────────────────────────────────────────────
async function main() {
  console.log('📋 ScholarFind Link Validator starting...\n');

  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const entries = extractEntries(html);
  console.log(`Found ${entries.length} entries to check\n`);

  const results = [];

  for (const entry of entries) {
    console.log(`Checking [${entry.id}] ${entry.title}`);
    console.log(`  URL: ${entry.url}`);

    const result = { ...entry, tier1: null, tier2: null, tier3: null, finalStatus: null };

    // --- Tier 1: HTTP ---
    result.tier1 = await checkHttpStatus(entry.url);
    console.log(`  Tier 1 (HTTP): ${result.tier1.ok ? '✅' : '🔴'} status=${result.tier1.status}${result.tier1.redirected ? ` → redirected to ${result.tier1.finalUrl}` : ''}`);

    if (!result.tier1.ok) {
      result.finalStatus = 'BROKEN';
      results.push(result);
      continue;
    }

    // --- Tier 2: Keyword presence ---
    // Use the final (redirected) URL for content check
    result.tier2 = await checkKeywordPresence(result.tier1.finalUrl, entry.title);
    console.log(`  Tier 2 (Keywords): ${result.tier2.passed ? '✅' : '⚠️'} match=${result.tier2.matchRatio}% keywords=[${result.tier2.matchedKeywords?.join(', ')}]`);

    if (result.tier2.passed && !result.tier1.redirected) {
      result.finalStatus = 'OK';
      results.push(result);
      continue;
    }

    // --- Tier 3: LLM check (for redirects or keyword failures) ---
    console.log(`  Tier 3 (LLM): running...`);
    result.tier3 = await checkLLMRelevance(
      result.tier1.finalUrl,
      entry.title,
      result.tier2.pageTextSnippet || ''
    );
    console.log(`  Tier 3 (LLM): ${result.tier3.skipped ? '⏭ skipped' : result.tier3.passed ? '✅' : '⚠️'} verdict=${result.tier3.verdict || 'skipped'}`);

    if (result.tier3.skipped) {
      result.finalStatus = result.tier2.passed ? 'OK' : 'NEEDS_REVIEW';
    } else {
      result.finalStatus = result.tier3.passed ? 'OK' : 'NEEDS_REVIEW';
    }

    results.push(result);

    // Small delay to be polite to servers
    await new Promise(r => setTimeout(r, 800));
  }

  // ─────────────────────────────────────────────
  // 6. BUILD REPORT
  // ─────────────────────────────────────────────
  const broken    = results.filter(r => r.finalStatus === 'BROKEN');
  const needsReview = results.filter(r => r.finalStatus === 'NEEDS_REVIEW');
  const ok        = results.filter(r => r.finalStatus === 'OK');

  const date = new Date().toISOString().split('T')[0];
  let report = `# ScholarFind Link Validation Report\n**Date:** ${date}  \n**Total checked:** ${results.length}  \n**✅ OK:** ${ok.length}  **⚠️ Needs Review:** ${needsReview.length}  **🔴 Broken:** ${broken.length}\n\n---\n\n`;

  if (broken.length > 0) {
    report += `## 🔴 BROKEN — Fix immediately (${broken.length})\n\n`;
    for (const r of broken) {
      report += `### ${r.title} \`[${r.id}]\`\n`;
      report += `- **URL:** ${r.url}\n`;
      report += `- **HTTP status:** ${r.tier1.status}${r.tier1.error ? ` (${r.tier1.error})` : ''}\n`;
      report += `- **Action:** Find working URL and update index.html\n\n`;
    }
  }

  if (needsReview.length > 0) {
    report += `## ⚠️ NEEDS REVIEW — May have drifted (${needsReview.length})\n\n`;
    for (const r of needsReview) {
      report += `### ${r.title} \`[${r.id}]\`\n`;
      report += `- **URL:** ${r.url}\n`;
      if (r.tier1.redirected) report += `- **⚠️ Redirected to:** ${r.tier1.finalUrl}\n`;
      if (r.tier2) report += `- **Keyword match:** ${r.tier2.matchRatio}% — missing: [${r.tier2.missingKeywords?.join(', ')}]\n`;
      if (r.tier3 && !r.tier3.skipped) report += `- **LLM verdict:** ${r.tier3.verdict} — ${r.tier3.explanation}\n`;
      report += `- **Action:** Manually visit URL and verify it still describes this opportunity\n\n`;
    }
  }

  if (ok.length > 0) {
    report += `## ✅ OK (${ok.length})\n\n`;
    for (const r of ok) {
      const redirect = r.tier1.redirected ? ` *(redirected but content OK)*` : '';
      report += `- **${r.title}** \`[${r.id}]\`${redirect}\n`;
    }
  }

  fs.writeFileSync('link-report.md', report);
  console.log(`\n✅ Report written to link-report.md`);
  console.log(`   Broken: ${broken.length} | Needs review: ${needsReview.length} | OK: ${ok.length}`);

  // Exit code 0 always — GitHub Actions step handles failure logic
  process.exit(0);
}

main().catch(err => {
  console.error('Validator failed:', err);
  process.exit(1);
});
