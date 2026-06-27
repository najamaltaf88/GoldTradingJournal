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

## Run locally

```powershell
copy .env.example .env
# Edit .env with your Supabase URL and anon key
npm start
```

`npm start` generates `env-config.js` then serves on `http://127.0.0.1:8000`.

For Google sign-in locally, add `http://127.0.0.1:8000/auth/callback` to Supabase Auth redirect URLs.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in **SQL Editor**.
3. Enable **Google** under Authentication → Providers.
4. Add redirect URL: `https://YOUR-SITE.netlify.app/auth/callback` (and local URL for dev).
5. Create a public **screenshots** storage bucket (5MB limit).
6. Copy **Project URL** and **anon public** key into `.env`.

## Files

- `index.html` — app structure
- `app.js` — logic and Supabase sync
- `scripts/generate-config.js` — reads `.env` → writes `env-config.js`
- `auth/callback/index.html` — Google OAuth redirect
- `supabase/schema.sql` — database schema
- `netlify.toml` — Netlify build (runs config generator)
- `manifest.json` / `sw.js` — PWA

## Deploy to Netlify

1. Connect the repo.
2. Build command: `node scripts/generate-config.js` (already in `netlify.toml`).
3. Publish directory: `.`
4. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Netlify environment variables.

## Screenshots

Uploads go to Supabase Storage (`screenshots` bucket). Sign-in required.

## Storage model

- **Supabase** is the source of truth after login.
- **localStorage** is an offline write buffer only.

## Export

- Excel: trade log, analysis, weekly reviews
- PDF: trade log, analysis, screenshots when present
