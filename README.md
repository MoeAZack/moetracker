# MoeAZack Valorant Tracker

Team scrim & match tracker for VALORANT — match/round logging, SD-PPR player
ratings, map & economy analytics, VOD review, lineup library, Solo Q sync,
Gemini-powered scoreboard import, and Discord match reports.

## 🔗 Live app

**https://moetracker.web.app**

(also reachable at the Cloud Run URL `https://moetracker-329619434756.europe-west1.run.app`)

## Stack

- Frontend: React + Vite (single-page app)
- Backend: Express (TypeScript), bundled with esbuild
- Data: Firestore (Native) — file fallback for local dev
- Hosting: Cloud Run (container) behind Firebase Hosting (`moetracker.web.app`)
- Secrets: Google Secret Manager · Scheduled jobs: Cloud Scheduler · AI: Gemini

## Run locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and generate unique values for the required
   `ADMIN_PASSWORD` and `JWT_SECRET` fields. Configure optional integration
   credentials there as well. Credentials are deployment secrets and are never
   stored in tracker data. Local dev uses a `db.json`
   file store; leave `USE_FIRESTORE` unset.
3. Run the dev server: `npm run dev`

## Deploy

```bash
npm run build
gcloud run deploy moetracker --source . --project moetracker-raad --region europe-west1
```

Firebase Hosting (`moetracker.web.app`) proxies all requests to the Cloud Run
service — see [firebase.json](firebase.json). No redeploy of Hosting is needed
for normal app changes; only the Cloud Run deploy above.

## Security notes

- Store production credentials in Google Secret Manager and expose them to Cloud Run
  as environment variables.
- `ADMIN_PASSWORD` and `JWT_SECRET` are mandatory and must be at least 24 characters.
- Supported optional secrets are `GEMINI_API_KEY`, `HENRIK_API_KEY`, `GRID_API_KEY`,
  `DISCORD_WEBHOOK_URL`, and `CRON_SECRET`.
- Rotate a credential immediately if it is ever committed to Git history.
