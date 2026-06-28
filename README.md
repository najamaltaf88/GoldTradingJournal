# Gold Trading Journal (XAUUSD)

Dark-theme XAUUSD trading journal for logging trades, reviewing performance, tracking PnL, and exporting reports. Data syncs to **Supabase** (Auth + PostgreSQL + Storage). Deploy on **Netlify**.

## Features

- Trade log with modal-based trade entry and screenshot uploads
- Dynamic dropdown options with custom values
- Analysis dashboard with performance breakdowns
- Monthly PnL calendar in $
- Weekly review notes
- Skipped / missed trade tracking
- AI mentor (OpenRouter)
- CSV, Excel, and PDF export
- Installable PWA support

## Secrets (.env only)

All Supabase credentials live in **`.env`** (never commit this file). The app does not read `.env` in the browser directly — a small script generates `env-config.js` at build/start time.

1. Copy `.env.example` to `.env`
2. Set your values:

```env
SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key-here
```

3. Generate the runtime config:

```powershell
node scripts/generate-config.js
```

Or use `npm run config`. This writes `env-config.js` (gitignored).

On **Netlify**, set the same variables under Site settings → Environment variables. The build runs `node scripts/generate-config.js` automatically (see `netlify.toml`).

The anon key is safe in client-side output. Row Level Security protects data. Never put the `service_role` key in `.env` for this app.

## Storage model

- **Supabase only** for journal data (trades, accounts, reviews, options, screenshots).
- **No localStorage** for journal data — old cached keys are cleared on startup.
- **localStorage** holds the Supabase auth session so it can persist across browser restarts on the same origin.
- **In-memory only** for the OpenRouter mentor API key (never written to disk).

## Google sign-in redirect URLs

Add **all** of these in Supabase → Authentication → URL Configuration → Redirect URLs:

```
https://goldtradingjournal.netlify.app/auth/callback
https://goldtradingjournal.netlify.app/
http://localhost:3000/auth/callback
http://localhost:3000/
http://127.0.0.1:8000/auth/callback
http://127.0.0.1:8000/
```

Set **Site URL** to your production URL (`https://goldtradingjournal.netlify.app`) or local dev URL (`http://localhost:3000`).

If Google redirects to `/?code=...` instead of `/auth/callback`, the app now handles that automatically.

## Run locally

```powershell
copy .env.example .env
# Edit .env with your Supabase URL and anon key
npm start
```

`npm start` generates `env-config.js` then serves on `http://127.0.0.1:8000`.

For port 3000 (e.g. `npx serve -p 3000`), use the localhost:3000 redirect URLs above.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in **SQL Editor**.
3. Enable **Google** under Authentication → Providers.
4. Add redirect URLs (see **Google sign-in redirect URLs** below).
5. Create a public **screenshots** storage bucket (5MB limit).
6. Copy **Project URL** and **anon public** key into `.env`.

## Files

- `index.html` — app structure
- `app.js` — logic and Supabase sync
- `scripts/generate-config.js` — reads `.env` → writes `env-config.js`
- `auth/callback/index.html` — Google OAuth redirect
- `supabase/schema.sql` — database schema
- `netlify.toml` — Netlify build (runs config generator)
- `manifest.json` — PWA manifest (no offline journal cache)

## Deploy to Netlify

1. Connect the repo.
2. Build command: `node scripts/generate-config.js` (already in `netlify.toml`).
3. Publish directory: `.`
4. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Netlify environment variables.

## Screenshots

Uploads go to Supabase Storage (`screenshots` bucket). Sign-in required.

## Storage model

- **Supabase** is the only store for journal data after sign-in.
- **sessionStorage** keeps the auth session for the current tab only.
- Service worker caching for the app shell has been removed to avoid stale data conflicts.

## Export

- Excel: trade log, analysis, weekly reviews
- PDF: trade log, analysis, screenshots when present
