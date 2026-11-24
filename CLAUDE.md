# Voice AI Demo

## Project Overview
Next.js app (`tavus-avatar/`) for an AWS Summit Sydney booth demo. Real-time conversational voice AI with Tavus video avatar, Deepgram STT/TTS, Amazon Bedrock LLM, Pipecat orchestration, Daily WebRTC transport, Krisp noise cancellation.

## Key Files
- `tavus-avatar/src/lib/tavus-api.ts` - Core API client (base URL: `https://tavusapi.com/v2`, auth via `x-api-key` header)
- `tavus-avatar/src/lib/tavus-personas.ts` - Persona resolution with derived persona creation & caching
- `tavus-avatar/src/lib/tavus-custom-llms.ts` - Custom LLM layer config (currently empty map)
- `tavus-avatar/src/lib/persona-tools.ts` - Tool definitions, event-aware (AWS: show_content, show_schedule, dismiss_content; Finance: show_pricing, show_payment_breakdown, dismiss_content)
- `tavus-avatar/src/lib/event.ts` - `isFinanceEvent()`, the single source of truth other event-aware modules branch on
- `tavus-avatar/src/lib/active-conversations.ts` / `visitor.ts` - per-visitor conversation tracking + anonymous session cookie (see "Production hardening" below)
- `tavus-avatar/src/lib/deal-context.ts` - short-lived external deal-data intake
- `tavus-avatar/src/lib/conversation-usage.ts` - conversation start/end cost-visibility logging
- `tavus-avatar/src/proxy.ts` - `DEMO_API_TOKEN` auth gate on `/api/*` (Next.js 16 "proxy", formerly `middleware.ts`; runs on Node.js, which Vercel's services mode requires)
- `tavus-avatar/src/types/tavus.ts` - TypeScript types for Tavus conversation messages
- `tavus-avatar/src/components/tavus-demo.tsx` - Main demo component with Daily.js integration
- `tavus-avatar/src/app/api/conversation/route.ts` - POST to create conversation
- `tavus-avatar/src/app/api/conversation/[conversationId]/route.ts` - DELETE to end conversation
- `tavus-avatar/src/app/api/deal-context/route.ts` - POST to store external deal data, returns `deal_id`
- `tavus-avatar/src/app/api/persona/setup-tools/route.ts` - PATCH persona with tool definitions
- `tavus-avatar/src/app/api/personas/route.ts` - GET list all personas
- `prompts/tavus-system-instruction-1.md` - System prompt for the booth assistant
- `agent-kiosk-shell/` - Electron kiosk shell for the booth display

## Environment Variables
- `TAVUS_API_KEY` - API key for Tavus
- `TAVUS_PERSONA_ID` - Default persona ID. **For Pipecat integrations, always use `pipecat-stream`** — this is a special Tavus persona (pipeline_mode: echo) that disables Tavus's own greeting and LLM, letting Pipecat handle all AI orchestration. It will NOT appear in `GET /v2/personas` list but is valid and available on all accounts.
- `EVENT_CONFIG` - Directory name under `prompts/` (default `aws-summit-mumbai-2026`). Selects the system prompt (`prompts/<event>/system-instruction.md`) and greeting (`prompts/<event>/greeting.md`, falls back to the AWS Summit Sydney greeting if absent). Forwarded into the client bundle via `next.config.ts`'s `env` field, so `src/lib/content-items.ts` and `src/lib/persona-tools.ts` can also branch on it (see `src/lib/event.ts`).
- `OPENAI_API_KEY` - only used by `scripts/create-finance-persona.ps1 -UseOpenAI` to point the finance persona's LLM layer at OpenAI directly instead of Tavus's built-in model. Not read by the running app itself.
- `DEEPGRAM_API_KEY` - Max's speech recognition. **Deepgram is the default engine** (`chooseSttEngine` in
  `src/lib/deepgram-stt.ts`): it streams the echo-cancelled mic using a short-lived token from
  `/api/stt/token`. If the key is missing, the token fails, or the connection is refused, the call falls back
  to the browser's recognizer *loudly*: one JSON `stt_fallback` line in the browser console (and
  `stt_token_failed` on the server), `sttFallbackReason` in the call log and in the Inspector turn table's
  STT column, and a "Speech recognition: browser fallback" banner on the call screen. `/api/health`
  reports `deepgramKey`, `sttDefault` and `sttToken.mintable` (it mints a real token to check).
- `NEXT_PUBLIC_STT_ENGINE` - optional; `webspeech` turns Deepgram off for every call (`?stt=webspeech` /
  `?stt=deepgram` in the URL overrides it per call). It is built into the client bundle: change it, then
  rebuild / redeploy.
- Max's AI switches (all off by default; each needs `XAI_API_KEY` or `OPENAI_API_KEY`, and a redeploy on
  Vercel; `/api/health` shows `mode`, `speech` and `understanding`):
  - `MAX_UNDERSTANDING=ai` - the AI reads longer replies at Beats 2-21 and picks what the customer meant
    from a fixed menu (`src/lib/ai-understanding.ts`); the script still chooses the words.
  - `MAX_SPEECH=ai` - Option C: the script picks the approved line, the AI says it in Max's own words, a
    checker falls back to the approved line on any new number, price, promise or dropped fact
    (`src/lib/ai-speech.ts`). Beat 1 and Beats 22-25 stay word for word.
  - With both of the above on, a turn the AI has to read uses ONE AI call (`src/lib/ai-reply.ts`,
    `combinedTurn` in `beat-controller.ts`): the controller first works out, without AI, the approved line
    every possible meaning leads to; the AI picks the meaning and words that line. The knowledge base and
    the backup classifier make no AI calls inside that turn (`src/lib/llm-context.ts`).
  - `MAX_STREAM=on` - streaming: `/api/chat/grok` answers the call screen's turns as NDJSON,
    `{"type":"early"}` with Max's first sentences once they pass the "adds nothing new" checks, then
    `{"type":"final"}` (its text starts with the early part). The call screen speaks the early part at
    once and the rest when it ends; the "was it heard" commit covers the whole reply. If the whole reply
    then fails a check, the approved line (or the script, in free mode) follows the early part. Works with
    Option C and free mode; off = one JSON reply as before. Not yet tried on a live HeyGen call.
  - `MAX_MODE=free` - Option D: the AI runs the whole call from the full script and knowledge base
    (`src/lib/free-ai.ts`, `processFreeTurn` in `beat-controller.ts`). Code still enforces the price
    ladder ($4 → $3.50 → $3.25 → $3, one step at a time, only from Beat 22), no invented figures or risky
    claims, and the word-for-word recording disclosure; a reply that fails twice, times out
    (`FREE_AI_TIMEOUT_MS`, default 4 s) or errors is taken by the scripted controller for that turn.
    Overrides the other two switches. Not approved by TXM for real customers.
- `SENTRY_DSN` - optional. Every error (uncaught route errors via `src/instrumentation.ts`
  `onRequestError`, the turn API's caught failures, and call-screen errors sent to `/api/client-error`)
  goes through `src/lib/error-report.ts`: always one JSON `"event":"error"` log line, and with this set,
  also to Sentry (no SDK, one HTTP request per error). `/api/health` shows `errorTracking`.
- `DEMO_API_TOKEN` - gates every `/api/*` route (except `/api/auth`) behind a shared login token, checked in `src/proxy.ts`. Unset → auth is skipped in dev, but **fails closed with 503** if `NODE_ENV=production` and it's still unset — a missing token in production means the deployment is misconfigured, not that auth should be silently disabled. Required for any deployment reachable outside your own machine.

## Digital Finance Manager event (`EVENT_CONFIG=digital-finance-manager`)
A second persona alongside the AWS booth demo: an F&I finance-manager voice agent built from a
real, TXM-approved dealership call script — walks a customer through a bundled protection package
(10yr bumper-to-bumper, 5yr maintenance, 5yr tire & wheel, GAP) and a negotiated daily-rate price,
instead of AWS content/schedule. Same app, same Daily/Tavus plumbing — only the prompt, tools, and
content panels differ, selected via `isFinanceEvent()` in `src/lib/event.ts`.
- `prompts/digital-finance-manager/system-instruction.md` - the approved script, adapted for voice
  delivery. Encodes the real negotiation floor ($4 → $3.50 → $3.25 → $3/day hard floor) and forbids
  the AI from ever stating a number outside that set, from any customer framing.
- `prompts/digital-finance-manager/greeting.md` - the call's opening line (legal recording/disclosure
  notice), spoken automatically before the LLM's own turn — must stay in sync with the "do not repeat
  this" instruction at the top of system-instruction.md.
- `src/lib/persona-tools.ts` - finance-event tools: `show_pricing({product})` (coverage-only panels,
  no price shown — these products are sold bundled, not itemized), `show_payment_breakdown({daily_rate})`
  (shows only the single rate currently being spoken, never the full negotiation ladder — the panel
  and the AI's voice must never disagree), `dismiss_content`.
- `src/app/content/pricing-{gap,vsc,tire-wheel,maintenance}/page.tsx`, `payment-breakdown/page.tsx`
  - the panels those tools display.
- `scripts/create-finance-persona.ps1` - one-time persona creation (stock replica + system prompt),
  reads keys from `.env.local` so they never need to be typed into a command.
- After changing the prompt or tools: authenticate (`POST /api/auth` with `DEMO_API_TOKEN`, once a
  token is set) then `POST /api/persona/setup-tools` and `POST /api/persona/sync-prompt` to push them
  onto the live persona.

## Production hardening
Tracks the gap between "convincing client demo" and "real product a dealership puts in front of
real customers" — full Tier 1 (launch-blocking) / Tier 2 (should-have-soon) breakdown lives in the
project planning thread, not in this repo. Below is what's actually landed in code so far.
- **Concurrency**: `src/lib/active-conversations.ts` tracks the active Tavus conversation per
  *visitor*, not globally — fixes a real bug where one customer starting a call used to silently end
  a different customer's live call. `src/lib/visitor.ts` issues an anonymous `visitor-id` cookie,
  separate from the shared `demo-session` auth cookie (everyone who logs in with the same
  `DEMO_API_TOKEN` gets an identical auth cookie, so auth alone can't tell visitors apart). Rate
  limiting in `src/app/api/conversation/route.ts` is keyed the same way.
- **Hard constraint**: all of the above is in-memory, process-local state. Correct on a single
  persistent Node process (Railway/Render/Fly.io-style hosting). **Do not deploy to a multi-instance
  or serverless host (e.g. Vercel functions) without first moving this to a shared store** (Redis,
  etc) — separate instances would each have an empty map and every guarantee above would silently
  stop working.
  Exception, Max's call state only: `src/lib/session-store.ts` loads/saves each call's beat-controller
  state and pending commit in Upstash Redis around every `/api/chat/grok` request when
  `UPSTASH_REDIS_REST_URL`/`KV_REST_API_URL` is set, so Max can run on Vercel's free plan
  (`docs/DEPLOY-VERCEL.md`). Call logs (`src/lib/call-log-store.ts`, read by the Inspector) and deal
  context (`src/lib/deal-context.ts`, 2-hour Redis expiry) use the same store. The Tavus-path maps above
  (active conversations, rate limits) are still per-instance; the visitor id is a cookie, so it needs none.
- **Deal-context intake**: `src/lib/deal-context.ts` + `POST /api/deal-context` — short-lived (2hr
  TTL) storage for real customer/vehicle/financing data from an external system (CRM/DMS), returns a
  `deal_id`. `POST /api/conversation?deal=<deal_id>` folds it into Tavus's `conversational_context`
  so the AI doesn't have to ask for information the dealership already has. Nothing calls the write
  side yet — it's the integration seam for whenever that system is ready.
- **Cost visibility**: `src/lib/conversation-usage.ts` logs `[conversation.started]` /
  `[conversation.ended]` (with duration) to stdout — the direct proxy for Tavus billing. First pass
  only; no aggregation/dashboard.
- **No human escalation**: removed at the client's request — there is no team behind the AI to hand
  off to. Max (`src/lib/beat-controller.ts`) never stops the call, offers a handoff, or shows an
  escalate panel because of a question: asking for a human gets `HANDOFF_LINE` and the beat is held;
  unanswerable questions get `UNKNOWN_QUESTION_LINE` and the call continues; two "no"s in a row get
  `REPEATED_NO_LINE` and move to the next beat. The call only ends on an explicit recording objection,
  a hang-up / goodbye, or script completion (two "no"s to the Beat 1 recording disclosure get
  `TAKE_TIME_LINE` and Max waits, PENDING TXM confirmation of the two-no rule); after that every turn
  gets the fixed `CLOSING_LINE`. `src/lib/multi-turn.test.ts` guards this. Legacy escalation code not
  yet deleted (unused by Max, do not build on it): the Tavus-path `escalate_to_human` tool in
  `persona-tools.ts`, `POST /api/escalation`, `src/app/content/escalate/page.tsx`, and the
  "6. Escalate" operator button in `src/components/liveavatar-demo.tsx`.
- **Presentation flow (Phase 2)**: during the explanation (Beats 6-21, `isPresentationBeat`) Max asks
  no check-ins and flows on (`flowPresentation` in `beat-controller.ts`; the call screen carries on
  after `CONTINUE_PAUSE_MS` = 1.5 s). A "no", "I'm confused" or "what does that mean" gets the beat's
  one-line recap (`beatRecap`; Beat 6's names the deal's car from TXM's brand table), never the whole
  paragraph again; "keep going / next / skip / stop repeating" (`isCarryOn`) move on; unclear turns
  move on; pushback or "hmm" gets the recap once; a lone word never jumps ahead. Question beats
  (consent, test drive, walkaround, price, close) are unchanged. `src/lib/presentation-flow.test.ts`.
- **Script facts (Phase 3)**: spoken corrections live in `formatSpeechText` (beats.json stays as
  written): labor $180-$200/hour (Beat 15, TXM-confirmed 2026-11-24), "premature wear and tear"
  (Beat 8). `scriptFactAnswer` answers warranty / defect / labor questions during the explanation
  from Beats 6, 7 and 15. No "I hear you" / "long day" lines. `src/lib/script-facts.test.ts`.
- **Coached rewordings, no approval** (`src/lib/learned-phrasing.ts`): a rewording in a coaching note
  ("instead of X say Y", "don't say X, say Y", "say Y instead of X", "change X to Y", "don't say X")
  is used at once, from Max's next line and in every later call (Upstash key `max:rephrase`; memory
  without Upstash), applied to every line Max speaks. Only words Max really says; never the price
  ladder or the recording disclosure. Max confirms with `COACH_APPLIED_LINE`; the Inspector's coaching
  table shows "Applied" / "Not applied". `GET /api/learned` lists them, `DELETE /api/learned?id=`
  removes one.
- **Conversation gaps (Phase 4)**: a lone unclear word mid-explanation ("Are") gets no reply
  (`fragment_hold`); it is joined to the customer's next words within `FRAGMENT_JOIN_MS`, or the call
  screen carries on after the pause + `SILENT_HOLD_EXTRA_MS`. "I don't want the maintenance / tires"
  (`coverageExclusion`): the approved exclusion lines during the explanation, `DROP_MAINTENANCE_LINE` /
  `DROP_COVERAGE_LINE` + the price question at Beat 22. After the call closes, the closing line is said
  once, then silence. `src/lib/phase4.test.ts`.
- **Reliability (Phase 5)**: the call screen warns "Max can't hear you" when no customer speech
  arrives `NO_CUSTOMER_AUDIO_MS` (25 s) after connecting (the 0-turn calls). The call-log send
  (`call-log-webhook.ts`) fits Vercel's 60 s limit: AI review up to 22 s, Make gets the rest of
  `SEND_BUDGET_MS` (55 s); a webhook that is merely slow keeps its send-once claim (`max:sent:<id>`),
  so a retry never adds a duplicate row (583241f0, c65e04c4). Only a failed connection is retried.
- **Self-learning (Phase 6)**, no approval, all visible and undoable on `/learning`:
  - Timing from coaching (`src/lib/learned-settings.ts`, Upstash `max:settings`): "don't cut me off /
    let me finish" -> +300 ms end-of-turn wait; "don't snooze" -> shorter pause between parts; "give
    them a moment" -> longer. Bounded (`SETTING_BOUNDS`), every change in `history`. Sent to the call
    screen as `learnedSettings` on every `/api/chat/grok` reply (and warmup).
  - In-call: a customer Max cut off (interrupted < 2.5 s into his line with 3+ words) gets +250 ms
    per cut-off for the rest of that call, up to 750 ms (`isCutOff` / `adaptedWaitMs` in turn-taking.ts).
  - Nightly (`src/lib/learning-report.ts`, Vercel cron in root `vercel.json` -> `/api/learning/nightly`,
    needs `CRON_SECRET`): reads the calls since the last run; customers cut off >= 1x per call over
    3+ calls -> +200 ms wait on its own; reports unanswered questions, repeats/confusion and where
    calls stop by beat, latency, and every coaching note's outcome. `/api/learning/report` (GET; POST
    run / reset-settings). `src/lib/self-learning.test.ts`.
- **Tests**: `npm test` (Vitest) covers the concurrency fix (including a real concurrent-HTTP-request
  integration test against a mocked Tavus API, so it doesn't need live Tavus credits), visitor cookie
  handling, the auth middleware's fail-closed behavior, and deal-context/usage-logging. `server-only`
  is aliased to a stub in `vitest.config.ts` since Next's bundler normally swaps it for a no-op and
  plain Node can't resolve the real package's conditional export.
- **Operational readiness**: `prompts/digital-finance-manager/pricing.json` is the single source of
  truth for negotiation tiers and product coverage text — `src/lib/pricing-config.ts` reads it and
  feeds the content pages *and* the persona tool schema (`show_pricing`/`show_payment_breakdown`
  enums), so changing prices/products doesn't require touching code, just running
  `scripts/push-pricing-config.ps1` afterward to push the regenerated tool schema. Full non-developer
  runbook: `docs/OPERATIONS.md`.
- **Known gaps, not yet closed**: still running on a personal machine behind ngrok, not a real
  persistent host; error tracking (Sentry) deferred until deployment; transcript capture via Tavus's
  `application.transcription_ready` webhook deferred (needs a public URL); no legal/compliance
  sign-off on the disclosure language for real customer use, separate from TXM approving the sales
  wording.

## Architecture
- Frontend creates conversation via Next.js API route -> Tavus API
- Daily.js call object joins the conversation URL returned by Tavus
- App messages from Daily carry Tavus events (tool calls, utterances, speaking state)
- Tool calls handled client-side: show_content, show_schedule, dismiss_content
- `conversation.echo` sent back to Tavus after tool execution
- Persona tools set via PATCH `/v2/personas/{id}` using JSON Patch (RFC 6902)

## Tavus API Reference

Base URL: `https://tavusapi.com/v2`
Auth: `x-api-key` header

### Conversations

**Create Conversation** - `POST /v2/conversations`
```json
{
  "persona_id": "string",
  "replica_id": "string",
  "callback_url": "string",
  "conversation_name": "string",
  "conversational_context": "string",
  "custom_greeting": "string",
  "document_ids": ["string"],
  "properties": {
    "max_call_duration": 3600,
    "participant_left_timeout": 30,
    "participant_absent_timeout": 300,
    "language": "english"
  }
}
```
Response: `{ conversation_id, conversation_url, ... }`

**End Conversation** - `POST /v2/conversations/{conversation_id}/end`

### Personas

**List** - `GET /v2/personas` → `{ data: [{ persona_id, persona_name, system_prompt, layers, ... }] }`

**Get** - `GET /v2/personas/{persona_id}`

**Create** - `POST /v2/personas`
```json
{
  "persona_name": "string",
  "pipeline_mode": "full",
  "system_prompt": "string",
  "context": "string",
  "default_replica_id": "string",
  "document_ids": ["string"],
  "document_tags": ["string"],
  "layers": { "llm": {}, "tts": {}, "stt": {} }
}
```

**Patch (JSON Patch RFC 6902)** - `PATCH /v2/personas/{persona_id}`
```json
[
  { "op": "replace", "path": "/persona_name", "value": "New Name" },
  { "op": "replace", "path": "/layers/llm/model", "value": "tavus-gpt-4o" },
  { "op": "replace", "path": "/layers/llm/tools", "value": [] },
  { "op": "replace", "path": "/layers/tts/tts_engine", "value": "cartesia" },
  { "op": "add", "path": "/layers/tts/tts_emotion_control", "value": "true" },
  { "op": "remove", "path": "/layers/stt/hotwords" },
  { "op": "replace", "path": "/layers/perception/perception_tool_prompt", "value": "..." }
]
```

### Persona Layers

**LLM** - Models: `tavus-llama-4` (default, fastest), `tavus-gpt-4o-mini` (balanced), `tavus-gpt-4o` (smartest). Supports custom OpenAI-compatible LLMs. Tool calling via `layers.llm.tools` in OpenAI function calling format.

**STT** - `tavus-turbo` (lowest latency), `tavus-advanced` (higher accuracy, recommended for non-English)

**TTS** - Default Tavus TTS (fastest). Custom engines: Cartesia, ElevenLabs.

**Perception** - `raven-0` for real-time visual understanding. Configure via `perception_tool_prompt`.

### Tool Calling
Tools defined in `layers.llm.tools` using OpenAI function calling format:
```json
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "...",
    "parameters": { "type": "object", "properties": {}, "required": [] }
  }
}
```
Tool calls arrive as Daily app-messages with `event_type: "conversation.tool_call"`.
Respond with `conversation.echo` message via `sendAppMessage()`.

### Conversation Events (via Daily app-messages)
- `conversation.utterance` - speech (properties: role, speech)
- `conversation.tool_call` - LLM invoked a tool (properties: name, arguments)
- `conversation.echo` - response after tool execution
- `conversation.user.started_speaking` / `stopped_speaking`
- `conversation.replica.started_speaking` / `stopped_speaking`
- `conversation.replica_interrupted`
- `system.replica_present` / `system.replica_joined`

### Webhook Events
- `application.transcription_ready` - transcript ready
- `application.perception_analysis` - visual summary ready
