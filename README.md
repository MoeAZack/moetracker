# MoeAZack Valorant Tracker

Team scrim & match tracker for VALORANT — match/round logging, SD-PPR player
ratings, map & economy analytics, VOD review, lineup library, Solo Q sync,
Gemini-powered scoreboard import, and Discord match reports.

## 🔗 Live app

**https://moetracker-site.pages.dev**

The shorter `moezack.pages.dev` project is provisioned, but the existing address
remains the canonical fallback until that Cloudflare edge route is reachable.

## Stack

- Frontend: React + Vite (single-page app)
- Backend: Express-compatible TypeScript running in a Cloudflare Worker
- Data: Cloudflare D1 — file fallback for local development
- Hosting: Cloudflare Pages with a Worker service binding
- Replay ingestion: always-on Windows collector; local parsing uploads bounded evidence

## Run locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and generate unique values for the required
   `ADMIN_PASSWORD` and `JWT_SECRET` fields. Configure optional integration
   credentials there as well. Credentials are deployment secrets and are never
   stored in tracker data. Local dev uses a `db.json`
   file store; leave `USE_FIRESTORE` unset.
3. Run the dev server: `npm run dev`

## Deploy to Cloudflare

```bash
npm run check
npm run cf:worker:deploy
npm run cf:pages:deploy
```

## Security notes

- Store production credentials as encrypted Cloudflare Worker secrets.
- `ADMIN_PASSWORD` and `JWT_SECRET` are mandatory and must be at least 24 characters.
- Supported optional secrets are `GEMINI_API_KEY`, `HENRIK_API_KEY`, `GRID_API_KEY`,
  `DISCORD_WEBHOOK_URL`, and `CRON_SECRET`.
- Rotate a credential immediately if it is ever committed to Git history.
