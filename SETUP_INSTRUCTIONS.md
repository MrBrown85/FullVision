# Setup Instructions

Follow these steps to finish configuring your dev environment. You can do this whenever you have 15 minutes.

---

## Step 1: Install Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Click the big green **LTS** button (left side) to download the installer
3. Open the downloaded `.pkg` file
4. Click through the installer (Next → Next → Install → Done)
5. **Quit Terminal completely** (Cmd+Q) and reopen it

Verify it worked:
```bash
node --version
npm --version
```

Both should print a version number.

---

## Step 2: Install project dependencies

```bash
cd ~/FullVision
npm install
```

This installs Prettier (code formatter) and Vitest (test runner). Takes about 30 seconds.

---

## Step 3: Format the codebase

```bash
npm run format
```

This applies consistent formatting across all JS, CSS, HTML, and JSON files. It's a one-time cleanup — after this, the CI pipeline will check formatting on every push.

---

## Step 4: Run tests

```bash
npm test
```

Should see all 47 calculation engine tests pass.

---

## Step 5: Run the app locally

```bash
npm run dev
```

Open [http://localhost:8347/app.html](http://localhost:8347/app.html) in your browser.

---

## Step 6 (optional): Push to GitHub with CI

If you want the GitHub Actions CI pipeline to work:

1. Create a repo on GitHub (private is fine)
2. Push your code:
```bash
cd ~/FullVision
git remote add origin https://github.com/YOUR_USERNAME/FullVision.git
git add -A
git commit -m "Initial commit"
git push -u origin main
```

Every push to `main` will now automatically run tests and check formatting.

---

## Available commands after setup

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start local dev server on port 8347 |
| `npm test` | Run calculation engine tests |
| `npm run test:watch` | Run tests in watch mode (re-runs on file changes) |
| `npm run format` | Format all code with Prettier |
| `npm run format:check` | Check formatting without changing files |

---

## Files created during this session

| File | Purpose |
|------|---------|
| `README.md` | Project overview, setup guide, and architecture summary |
| `.env.example` | Documents required Supabase credentials |
| `docs/ARCHITECTURE.md` | Technical guide for developers (routing, data layer, calc engine) |
| `supabase_migration.sql` | Single SQL file to recreate the entire database from scratch |
| `package.json` | Node project config with dev/test/format scripts |
| `.prettierrc` | Code formatting rules |
| `.prettierignore` | Files excluded from formatting |
| `.github/workflows/ci.yml` | GitHub Actions pipeline (test + format check on every push) |
| `.gitignore` | Updated to exclude node_modules, .env files |
| `SETUP_INSTRUCTIONS.md` | This file |
