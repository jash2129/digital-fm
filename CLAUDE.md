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
- `tavus-avatar/src/middleware.ts` - `DEMO_API_TOKEN` auth gate on `/api/*`
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
- `DEMO_API_TOKEN` - gates every `/api/*` route (except `/api/auth`) behind a shared login token, checked in `src/middleware.ts`. Unset → auth is skipped in dev, but **fails closed with 503** if `NODE_ENV=production` and it's still unset — a missing token in production means the deployment is misconfigured, not that auth should be silently disabled. Required for any deployment reachable outside your own machine.

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
  `REPEATED_NO_LINE` and move to the next beat. The call only ends on a recording objection (or two
  "no"s to the Beat 1 recording disclosure), a hang-up, or script completion; after that every turn
  gets the fixed `CLOSING_LINE`. `src/lib/multi-turn.test.ts` guards this. Legacy escalation code not
  yet deleted (unused by Max, do not build on it): the Tavus-path `escalate_to_human` tool in
  `persona-tools.ts`, `POST /api/escalation`, `src/app/content/escalate/page.tsx`, and the
  "6. Escalate" operator button in `src/components/liveavatar-demo.tsx`.
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
