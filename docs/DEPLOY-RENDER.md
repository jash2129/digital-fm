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
   | `CALL_LOG_WEBHOOK_URL` | `.env.local`. Sends every finished call to the call log sheet (`docs/MAKE-CALL-LOG.md`). |
   | `CALL_LOG_SECRET` | `.env.local`. Must match the secret in the Make scenario's filter. |

4. Click **Apply**. The first build takes a few minutes. When it is live, open the
   `https://max-finance-manager-xxxx.onrender.com` URL Render shows and sign in with
   `DEMO_API_TOKEN`.

## Cost

**Free.** `render.yaml` uses Render's free plan, which comes with two catches:

- **It sleeps after about 15 minutes with no traffic.** The next visitor waits about a minute while
  it wakes up. Before a demo, open the URL a minute or two early so it is awake. A call in progress
  keeps it awake.
- **No persistent disk.** Call logs are lost whenever the server sleeps, restarts or redeploys, so the
  Inspector only shows calls since the last wake-up. Open the Inspector right after a call if you
  need it.

To remove both catches later (about $7/month plus about $0.25/month for the disk): in `render.yaml`
change `plan: free` to `plan: starter` and add a disk under the service:

```yaml
    disk:
      name: call-logs
      mountPath: /opt/render/project/src/tavus-avatar/logs-heygen
      sizeGB: 1
```

## Deploying a new version

Auto-deploy is **off** on purpose: a deploy restarts the server and ends any call in progress.

1. Push your changes to `main` as usual.
2. When no one is on a call, open the service in Render and click **Manual Deploy** → **Deploy
   latest commit**.

## Call logs and the Inspector

Open the Inspector at `https://<your-render-url>/inspector?session=<session id>`. On the free plan
the logs only last until the server next sleeps, restarts or redeploys (see Cost above).

## Limits to know

- **One server only.** Do not raise the instance count above 1 or turn on autoscaling: a second
  instance would have its own empty memory, and calls would break whenever a turn reaches it.
- **A deploy or restart ends live calls.** Deploy between calls.
