# Gold Strategytestor

Gold Strategytestor is a dark-theme XAUUSD trading journal web app for logging trades, reviewing performance, tracking PnL, and exporting reports.

## Features

- Trade log with modal-based trade entry
- Dynamic dropdown options with custom values
- Analysis dashboard with performance breakdowns
- Monthly PnL calendar in $
- Weekly review notes
- CSV, Excel, and PDF export
- Installable PWA support

## Files

- `index.html` - app structure
- `styles.css` - app styling
- `app.js` - app logic and localStorage state
- `manifest.json` / `sw.js` - installable app support

## Run locally

Open `index.html` directly, or serve the folder with a local server for PWA features:

```powershell
python -m http.server 8000
```

Then visit `http://127.0.0.1:8000`.

## Firebase config

The public repo does not include live Firebase keys. To enable Google sign-in and cloud sync:

1. Copy `firebase-config.example.js` to `firebase-config.js`.
2. Fill `firebase-config.js` with your Firebase web app config.
3. Enable Google Authentication, Firestore, and Realtime Database in Firebase.

`firebase-config.js` is ignored by git so project-specific values are not pushed.

## Cloudinary screenshots

Trade screenshots are uploaded directly to Cloudinary with an unsigned upload preset. Firestore stores only the returned `secure_url`.

1. Create a free Cloudinary account.
2. Create an unsigned upload preset named `gold_journal_trades`.
3. In `app.js`, replace `CLOUDINARY_CLOUD_NAME` with your Cloudinary cloud name.
4. Keep the preset unsigned and restricted to images.

If Cloudinary is not configured or an upload fails, trades still save normally without a screenshot.

## Storage

The app stores journal data in browser `localStorage` and can sync it to Firebase when configured, including:

- Trades
- Trade screenshot URLs
- Dynamic options
- Weekly reviews

## Export

- Excel export includes trade log, analysis, and weekly reviews
- PDF export includes formatted trade log, analysis, and trade screenshots when present
