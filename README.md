# Gold Strategytestor

Gold Strategytestor is a dark-theme XAUUSD trading journal web app for logging trades, reviewing performance, tracking PnL, and exporting reports.

## Features

- Trade log with modal-based trade entry
- Dynamic dropdown options with custom values
- Analysis dashboard with performance breakdowns
- Monthly PnL calendar in pips
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

## Storage

The app stores journal data in browser `localStorage` and can sync it to Firebase when configured, including:

- Trades
- Dynamic options
- Weekly reviews

## Export

- Excel export includes trade log, analysis, and weekly reviews
- PDF export includes formatted trade log and analysis
