# ScholarFind — Automated Update Setup Guide

## What this does
Every Sunday at 9am, GitHub automatically:
1. Runs an AI search for scholarship/internship updates near Phoenixville 19460
2. Opens a Pull Request showing exactly what changed
3. Emails you a link — you review and click Merge (or Close to skip)
4. Netlify auto-deploys in ~30 seconds

Your total time per week: ~5 minutes.

---

## One-time setup (do this once)

### Step 1 — Create a GitHub account
Go to github.com and sign up for a free account.

### Step 2 — Create a new repository
1. Click the "+" icon → "New repository"
2. Name it: `scholarfind`
3. Set to Public (required for free Netlify auto-deploy)
4. Click "Create repository"

### Step 3 — Upload your files
In your new repository:
1. Click "uploading an existing file"
2. Upload ALL files from this folder (drag the whole folder)
3. Click "Commit changes"

### Step 4 — Get an Anthropic API key
1. Go to console.anthropic.com
2. Sign up for a free account
3. Go to "API Keys" → "Create Key"
4. Copy the key (starts with sk-ant-...)
5. Note: costs ~$0.10–0.30 per weekly run (very cheap)

### Step 5 — Add the API key to GitHub
1. In your GitHub repo, click Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: ANTHROPIC_API_KEY
4. Value: paste your API key
5. Click "Add secret"

### Step 6 — Connect Netlify to GitHub
1. Go to netlify.com → "Add new site" → "Import an existing project"
2. Connect to GitHub and select your `scholarfind` repo
3. Set publish directory to: . (just a dot)
4. Click "Deploy site"

Now whenever you merge a Pull Request, Netlify automatically redeploys.

### Step 7 — Test it manually
1. In GitHub, go to Actions tab
2. Click "Weekly scholarship update" → "Run workflow" → "Run workflow"
3. Wait ~2 minutes, then check the Pull Requests tab
4. You should see a new PR with the AI's proposed changes

---

## Every week (your 5-minute job)

You'll get an email from GitHub: "Pull request opened: Weekly data update"

1. Click the link in the email
2. Click the "Files changed" tab — review what the AI changed
3. If it looks good → click "Merge pull request" → "Confirm merge"
4. If something looks wrong → click "Close pull request" to skip this week

That's it. Netlify deploys automatically after merge.

---

## Cost estimate
- GitHub: Free
- Netlify: Free
- Anthropic API: ~$0.10–0.30/week = ~$5–15/year
- Domain (optional): ~$10/year
