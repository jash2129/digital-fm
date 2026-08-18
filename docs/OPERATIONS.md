# Digital Finance Manager — Operations Guide

For whoever is running this day to day — not written for developers. If a step below says
"ask a developer," that's a deliberate line, not a gap in this doc.

---

## What this is, in one paragraph

A video call with an AI finance manager. A customer joins a link, the AI walks them through
protection products (bumper-to-bumper, maintenance, tire & wheel, GAP) using a real approved
script, shows pricing panels, and can hand off to a real person if a customer needs one. It's
currently running on a developer's machine, tunneled to a public URL — see **Known
Limitations** at the bottom before treating this as fully "live."

---

## Changing prices or what's covered — no developer needed

Everything a dealership would actually want to change lives in one file:

**`prompts/digital-finance-manager/pricing.json`**

Open it in any text editor. You can safely change:
- `negotiation.openingRateUsd` / `tiersUsd` / `floorRateUsd` — the starting price and how far
  it can be negotiated down. Keep `floorRateUsd` as the lowest number in `tiersUsd`.
- Each product's `label`, `title`, `description`, and `bullets` — what's shown and said about
  each product.

**Do not** rename the product keys (`vsc`, `maintenance`, `tire_wheel`, `gap`) — those are
wired into the AI's tool definitions. Change the `label`/`title`/etc. values, not the keys.

After saving your changes, run one command to push the update live:

```
powershell -File tavus-avatar/scripts/push-pricing-config.ps1 -BaseUrl <the https:// URL the app is running on>
```

This updates the AI's tool definitions to match. **The content panels update automatically**
on the next page load — no push needed for those, only for the pricing/product numbers the AI
itself is allowed to say.

**One thing this file does NOT change**: the wording of the sales script itself
(`prompts/digital-finance-manager/system-instruction.md`) is separate, TXM-approved prose. If
you change the negotiation numbers in `pricing.json`, check that script for any place those
same numbers are spelled out in the script text — they need to match by hand; nothing
auto-syncs the prose today.

---

## Checking if it's healthy

- Open the app's URL in a browser. You should see the landing page with a "Start demo" button.
- Click Start demo, allow camera/microphone, and confirm the avatar appears and responds.
- If the page doesn't load at all, the server has probably stopped — see **Starting the app**.

---

## Starting / stopping the app

This assumes you have the code on a machine with Node.js installed.

**Start (production mode — use this, not "npm run dev", for anything other than active
development):**
```
cd tavus-avatar
npm run build
npm run start
```

**Stop:** close the terminal window it's running in, or press Ctrl+C in it.

If you changed and rebuilt while it was already running, stop it first — a running server
locks a file the build process needs to replace, and the build will fail until you do.

---

## The access token

Every visitor needs a login token before the app will do anything (this stops a random person
who finds the link from starting conversations on your bill). It lives in
`tavus-avatar/.env.local` as `DEMO_API_TOKEN`.

- **To share access**: give someone the app's URL plus this token. They go to `<url>/auth`,
  enter it, and they're in for 8 hours.
- **To rotate it** (e.g. after sharing it more widely than intended): generate a new random
  value, update `DEMO_API_TOKEN` in `.env.local`, restart the app. Everyone's old login stops
  working immediately; share the new token with whoever still needs access.

---

## Checking real cost / usage

The app logs conversation start/end times to its own console output, which gives you call
*duration* — but that's an estimate, not your actual bill. **For real spend, check the source
of truth directly:**
- **Tavus dashboard** (platform.tavus.io) — conversation minutes used, plan limits, billing.
  This is also where you'll see "out of conversational credits" errors coming from if the app
  stops letting people start calls — check here first if that happens.
- **OpenAI dashboard** (platform.openai.com/usage) — token spend, if the persona is configured
  to use your own OpenAI key rather than Tavus's built-in model.

---

## Checking on price-floor escalations

Any time a customer pushes past the $3/day floor (or whatever `floorRateUsd` is currently set
to), the AI calls a hand-off tool instead of inventing a lower number. Right now this is logged
to the server's console output only — search it for `[escalate_to_human]` — there is **no live
paging to a phone/Slack/email yet**. If you need that, ask a developer to wire one in;
`tavus-avatar/src/app/api/escalation/route.ts` is the single place that needs to change.

---

## When something's broken

- **"Out of conversational credits" errors** → Tavus plan/billing issue, not a bug. Check the
  Tavus dashboard.
- **Page loads but "Start demo" does nothing** → check the server's console output for errors;
  ask a developer.
- **Wrong prices/wording showing up** → check `pricing.json` was saved correctly and that
  `push-pricing-config.ps1` was run afterward (content panels update on their own; the AI's
  tool definitions do not, until pushed).
- **Anything else** → ask a developer. *(Fill in a real contact/escalation path here once one
  exists — there isn't one documented yet.)*

---

## Known Limitations (as of this writing)

- Running on a developer's personal machine + a temporary public tunnel (ngrok), not real
  hosting. It goes down if that machine sleeps, reboots, or loses its network connection.
- No error-tracking/alerting service — problems are only visible if someone is actively
  watching the console output.
- No legal/compliance sign-off on the recording/disclosure language — TXM approved the sales
  wording, which is a different approval from a compliance review of what an AI is legally
  allowed to tell a real customer.
- Escalation hand-off is logged only, not paged to a real person yet (see above).
