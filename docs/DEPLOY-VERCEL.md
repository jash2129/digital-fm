# Deploying Max on Vercel (free plan)

Max (the `tavus-avatar/` app) on Vercel's free **Hobby** plan, plus a free **Upstash Redis** database
for call state. Testers get a link that works whenever your PC is off.

## Why it needs Upstash

On Vercel each request can run on a different short-lived server with empty memory. Max keeps each
call's place in the script in memory, so without a shared store a call would forget where it was
mid-conversation. With Upstash connected, every turn loads the call's state before it runs and saves
it afterwards (`src/lib/session-store.ts`). Without Upstash the app logs:
`Running on Vercel without Upstash: calls will lose their place`.

On your own PC nothing changes: with no Upstash settings, everything stays in memory as before.

## One-time setup (about 15 minutes)

### 1. Create the project

1. Sign in at https://vercel.com with your GitHub account.
2. **Add New → Project**, find this repository, click **Import**.
3. **Root Directory:** click **Edit** and choose `tavus-avatar`. Framework Preset shows **Next.js**.
4. Open **Environment Variables** and add these (copy values from `tavus-avatar/.env.local`):

   | Name | Value |
   |---|---|
   | `EVENT_CONFIG` | `digital-finance-manager` |
   | `DEMO_API_TOKEN` | A password you choose. Testers sign in with it. **Required:** without it every request fails. |
   | `HEYGEN_API_KEY` | `.env.local` |
   | `HEYGEN_AVATAR_ID` | `.env.local` |
   | `XAI_API_KEY` | `.env.local` |
   | `GROK_MODEL` | `.env.local` |
   | `OPENAI_API_KEY` | `.env.local` |
   | `CALL_LOG_WEBHOOK_URL` | `.env.local` (the Make webhook) |
   | `CALL_LOG_SECRET` | `.env.local` |
   | `DEALERSHIP_NAME` | Optional |

5. Click **Deploy**. The first build takes a few minutes.

### 2. Connect Upstash (do not skip)

1. In the project, open the **Storage** tab → **Create Database** → **Upstash** (Redis) → **Continue**.
2. Pick the **Free** plan and the region closest to Vercel's (**us-east-1 / Washington, D.C.** is
   Vercel's default). Name it `max-calls`.
3. **Connect** it to this project for all environments. Vercel adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically; the app reads those.
4. **Deployments** tab → the latest deployment's **⋯** → **Redeploy**, so it picks up the new
   variables.

### 3. Check it

1. Open the `https://<project>.vercel.app` link and sign in with `DEMO_API_TOKEN`.
2. Make a short call past the recording disclosure into Beat 2 or 3, then end it.
3. A row appears in the call log sheet within a few seconds, with **Furthest Beat** filled in. If
   Furthest Beat is blank or the call kept repeating the opening, Upstash is not connected: recheck
   step 2.

Share the link and the `DEMO_API_TOKEN` password with testers.

## Deploying changes

Vercel deploys every push to `main` automatically. A deploy does not end calls in progress (new
calls use the new version), but avoid pushing while testers are on calls.

## What is different from running it on your PC

- **The Inspector works**, at `https://<project>.vercel.app/inspector`: every call's log (transcript,
  timeline, latency table, cut-offs, echo drops, analysis) is kept in Upstash for 30 days
  (`src/lib/call-log-store.ts`), so any server can open it.
- **Recordings are in Google Drive, not on Vercel.** The Inspector shows an **Open recording (Google
  Drive)** button instead of its player, once the Make scenario returns the Drive link (see
  "Webhook response" in `MAKE-CALL-LOG.md`). The second-by-second audio sync only works where the
  audio file is on the server (your PC, Render).
- **The call log sheet is the permanent record**: transcript, recording, log and analysis for every
  call. Upstash keeps logs for 30 days.
- **Testers should keep the page open for a few seconds after ending a call**, while the call is
  saved. The end screen says so.
- **No sleep.** Unlike Render's free plan, there is no one-minute wake-up.

## Free plan limits

- **Vercel Hobby** is meant for personal, non-commercial projects. Testing is fine; for real
  dealership use, move to a paid plan or a persistent host (`DEPLOY-RENDER.md`).
- **Requests:** at most 4.5 MB each and 60 seconds (set in the call-log and audio routes).
  Recordings over 3 MB (about 17 minutes) are sent to the sheet without the audio.
- **Upstash free:** far more requests than 10 testers will use (each turn is two small requests).
