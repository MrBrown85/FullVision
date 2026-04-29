# Real-Supabase end-to-end tests

These tests exercise the production write path against the live `gradebook-prod` Supabase project. Unlike `e2e/` (which mocks auth and seeds via `localStorage`), these tests sign in as a real user, hit real RPCs, and assert state by querying tables directly.

They exist because the mocked tests cannot detect data-loss bugs that live in the auth + RPC layer.

## What they cover today

- **Curriculum competencies persist after sign-out.** Currently fails — `_dispatchMapToV2` calls `upsert_tag` with the wrong UUID and Postgres throws "tag not found".
- **Students added through the class manager persist after sign-out.** Currently fails — `saveStudents` queues a canonical RPC but `signOut` clears `localStorage` before the queue drains.
- **User-created categories appear in the assignment-form dropdown.** Currently fails — `get_gradebook` doesn't return categories, and `_cache.categories` stays empty.

Each test is expected to fail on `main` today. They should pass once the underlying bugs are fixed.

## Required setup

These tests are skipped automatically when env vars are missing. To run them locally you need:

1. **A disposable test account in `gradebook-prod`.** Sign up at https://fullvision.ca/login.html with an email like `fv-tests+1@example.com`. This account will accumulate test courses (the suite archives them at the start of each run, but they aren't hard-deleted).

2. **A `.env` at repo root** with the following (gitignored — do not commit):

   ```
   SUPABASE_URL=https://novsfeqjhbleyyaztmlh.supabase.co
   SUPABASE_KEY=sb_publishable_FfgtpNV7PStzUvYVD7qWOg_aAVjGrTY
   TEST_USER_EMAIL=fv-tests+1@example.com
   TEST_USER_PASSWORD=<the-password-you-set>
   ```

   `SUPABASE_URL` and `SUPABASE_KEY` are also used by `npm run dev:local`. The publishable key shown is the production `prod202604` key; the legacy anon key works too.

3. **Playwright browsers installed.** If you've already run `npm test:e2e` once they are. Otherwise: `npx playwright install chromium`.

## Running

```bash
npm run test:e2e:real
```

To watch the browser during a run:

```bash
npx playwright test --config=playwright.real.config.js --headed
```

To target one test:

```bash
npx playwright test --config=playwright.real.config.js -g "competencies persist"
```

## What these tests don't do

- **They don't reset the test account between runs.** Courses get archived (not deleted), so the auth.users row + accumulated archived courses persist. If the test user account drifts into a weird state, sign in via the UI and clean up manually.
- **They don't run in CI without further work.** CI would need the `TEST_USER_*` and `SUPABASE_*` secrets configured. Until then, run locally before merging anything that touches the persistence layer.
- **They run serially (one worker).** The tests share a test user and would race on cleanup if parallelized.
