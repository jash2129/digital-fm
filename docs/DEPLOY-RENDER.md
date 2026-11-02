# Deploying Max on Render

Max (the `tavus-avatar/` app) runs as one always-on Node server on Render. The settings live in
`render.yaml` at the repo root. Nothing deploys until you create the service in Render and click
deploy.

**Why not Vercel:** each call's state is kept in the server's memory. Vercel spreads requests across
short-lived instances, so a customer's next turn could reach a server that has never seen their
call. Moving that state to a shared store (Redis) is a separate project.

## One-time setup (about 10 minutes)

1. Sign in at https://dashboard.render.com and connect your GitHub account.
2. Click **New** → **Blueprint**, pick this repository, and confirm. Render reads `render.yaml`
   and creates the `max-finance-manager` web service.
3. Render asks for the values marked `sync: false`. Copy each one from `tavus-avatar/.env.local`:

   | Variable | Where it comes from |
   |---|---|
   | `DEMO_API_TOKEN` | A password you choose. Everyone opening the demo signs in with it. Required. |
   | `HEYGEN_API_KEY` | `.env.local` |
   | `HEYGEN_AVATAR_ID` | `.env.local` |
   | `XAI_API_KEY` | `.env.local` |
   | `GROK_MODEL` | `.env.local` |
   | `OPENAI_API_KEY` | `.env.local` |
   | `DEALERSHIP_NAME` | Optional. The dealership name shown in the header. Leave blank for a generic label. |

4. Click **Apply**. The first build takes a few minutes. When it is live, open the
   `https://max-finance-manager-xxxx.onrender.com` URL Render shows and sign in with
   `DEMO_API_TOKEN`.

## Cost

The **Starter** plan (about $7/month) plus a 1 GB disk (about $0.25/month). Do not switch to the free
plan: it sleeps when idle, which ends live calls and adds a one-minute wait on the next visit.

## Deploying a new version

Auto-deploy is **off** on purpose: a deploy restarts the server and ends any call in progress.

1. Push your changes to `main` as usual.
2. When no one is on a call, open the service in Render and click **Manual Deploy** → **Deploy
   latest commit**.

## Call logs and the Inspector

Call logs are saved on the service's disk (`tavus-avatar/logs-heygen`), so they survive restarts and
redeploys. Open the Inspector at `https://<your-render-url>/inspector?session=<session id>`.

## Limits to know

- **One server only.** Do not raise the instance count above 1 or turn on autoscaling: a second
  instance would have its own empty memory, and calls would break whenever a turn reaches it.
- **A deploy or restart ends live calls.** Deploy between calls.
