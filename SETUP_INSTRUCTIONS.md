# Setup Instructions

Pick the path that fits — Demo Mode is the fastest way to see the app, full setup is for real development against Supabase.

---

## Fastest path: Demo Mode (no install)

1. Visit [fullvision.ca](https://fullvision.ca)
2. Click **"Try Demo Mode"** on the login screen
3. The Science 8 sample class loads with 27 students, learning map, assessments, and pre-populated scores

Demo data lives in your browser's localStorage. Sign-out wipes it.

---

## Full development setup

### Step 1: Install Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** installer
3. Open the `.pkg`, click through, install
4. **Quit Terminal completely** (Cmd+Q) and reopen it

Verify:
```bash
node --version    # should print v20.x.x or newer
npm --version
```

### Step 2: Clone and install

```bash
git clone https://github.com/MrBrown85/TeacherDashboard.git ~/Documents/FullVision
cd ~/Documents/FullVision
npm install
```

Installs Prettier, Vitest, Playwright, and linkedom. Takes ~30 seconds.

### Step 3: Run the unit suite

```bash
npm test
```

Should print **648 passed, 5 skipped**.

### Step 4: Run the E2E suite (optional)

First time only — install the headless browser:
```bash
npx playwright install chromium
```

Then:
```bash
npm run test:e2e          # headless (137 tests, ~25 min)
npm run test:e2e:headed   # see the browser
```

### Step 5: Run the app locally

```bash
npm run dev
```

Opens on port 8347. The root redirects to `/login.html`. To skip auth, click **"Try Demo Mode"** — `npm run dev` runs `serve` without env-var injection, so the real Supabase login won't work locally.

---

## Available commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Local dev server on port 8347 |
| `npm test` | Vitest unit suite (one-shot) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright E2E suite (headless) |
| `npm run test:e2e:headed` | Playwright with visible browser |
| `npm run format` | Format all code with Prettier |
| `npm run format:check` | Check formatting without writing |
| `npm run build` | `bash scripts/build.sh` — copies public files to `dist/` for Netlify |

---

## Deploying to Netlify

The repo auto-deploys on push to `main`. Netlify env vars to set on the site:

| Variable | Source |
|----------|--------|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_KEY` | Supabase → Project Settings → API Keys → publishable |

These are injected at edge by [`netlify/edge-functions/inject-env.js`](netlify/edge-functions/inject-env.js) — never committed to source.

Bump [`sw.js`](sw.js) `CACHE_NAME` on every deploy so installed PWAs reload fresh.
