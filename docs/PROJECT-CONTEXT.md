# Project Context — Digital Finance Manager ("Max")
*Last updated: Aug 16 call. This file reflects TXM's latest confirmed decisions — keep it current as new calls happen.*

---

## Current Priority (single focus, per TXM's explicit instruction)

**Digital Finance Manager ("Max") — presentation-ready demo for the dealership owner. Nothing else is active right now.**

Accounting automation is explicitly paused per TXM's instruction. Do not build or promise accounting work. Research can continue quietly but is not a committed deliverable.

---

## The Exact Use Case to Build (TXM's own words, Aug 16)

> "Just the finance manager just ready for presentation... I can show it and do it with the owner... he'll be talking with the owner by his name, presenting a car to him, tell him about the car, tell him about his payment, and sell him the warranty."

Four steps, nothing more, for this phase:
1. **Verify** — customer name, address, phone, vehicle (brand, make, year, model, color)
2. **Present** — full Four Square script (warranty hook → wear-and-tear story → cost case → product offer)
3. **Overcome objections** — realistic pushback, hold a price floor, don't cave immediately
4. **Close** — confirm verbally, end there

No RouteOne, no Tekion writes, no accounting, no two-agent handoff in this phase.

---

## Architecture Decisions (confirmed, don't re-litigate)

- **Platform is deliberately separate from Tekion.** TXM's words: "We don't want Tekion to see our presentation... the only status of the customer or deal is to update in Tekion, that's it." Tekion only ever receives final status updates — never sees the actual conversation.
- **Split-screen web app, not a real Zoom/Teams call.** Avatar on one side, dynamic content panel on the other.
- **OpenAI for the LLM layer, not Claude** — Tavus's LLM layer is natively OpenAI-format; avoids needing a proxy.
- **Stock Tavus replica for now** — TXM's cloned voice/face requires a separate consent recording session, not yet done. Don't block the demo on this.

---

## Known Limitations / Open Items (do not treat as blockers for the demo)

| Limitation | Status | Blocks the demo? |
|---|---|---|
| RouteOne integration (API vs. UI automation) | Unresolved — 1-agent vs. 2-agent decision pending RouteOne API docs/pricing check | No — out of scope for this phase |
| Real price floor / negotiation ceiling | No fixed number exists — actual ceiling is set per-bank, per-approval-tier via RouteOne's rate programs. Not yet built as a rules engine. | No — demo uses a placeholder floor ($3/day) |
| Tekion's Terms of Use likely prohibit the browser-automation approach used for reads/writes | Confirmed via ToS research — real risk if ever scaled to production | No — demo has zero Tekion interaction |
| No native Tekion notification when a deal lands in F&I | Confirmed gap, flagged as a future quick-win | No |
| Sales Manager login couldn't add F&I products from the F&I board (had to use Desking) | Platform quirk, noted | No — no Tekion writes in this phase |
| RouteOne requires VPN + 2FA every login, unreliable session persistence | Confirmed via live walkthrough | No — reinforces why RouteOne stays out of scope now |
| Official Tekion API access (Automotive Partner Cloud) | Process identified, multi-week, requires dealership owner's approval separately from Tekion's partner approval | No — running in parallel, not urgent |

---

## Max's Current Scope (system prompt already built)

See `@max-demo-system-prompt.md` for the full system prompt. Summary:
- Warm, conversational tone — never robotic, never denies being AI if asked directly
- Verifies customer/vehicle info conversationally, not like a form
- Delivers the Four Square presentation using TXM's real script (warranty terms → defect-only explanation → wear-and-tear case → product bundle offer)
- Anchors pricing in small daily terms (e.g., "$4 a day")
- Holds firm on objections before conceding, negotiates in stages if pushed, hard floor at $3/day for this demo
- Closes verbally, does not simulate signing or bank submission

---

## What's Explicitly NOT in Scope Right Now

- Accounting automation (paused)
- RouteOne submission/signing
- Two-agent (Agent A verification + Agent B presentation) handoff — single agent (Max) is sufficient for this phase
- Real Tekion reads or writes of any kind
- TXM's cloned voice/face (pending his consent recording)
- Official Tekion API access (in progress separately, not urgent)

---

## Next Concrete Steps

1. Finish tuning Max's system prompt against TXM playing the rudest possible customer
2. Add the countdown screen before the call (`@CountdownScreen.tsx`)
3. Schedule the live demo for the dealership owner once Max holds up under adversarial testing
4. Continue the Tekion API access process in parallel (see `@tekion-api-access-process.md`) — not urgent, not a blocker

---

## Reference Files
- `@max-demo-system-prompt.md` — Max's full system prompt
- `@dfm-task-flow-pre-in-post-call.md` — full pre/in/post-call SOP (production-scope, beyond the demo)
- `@two-agent-dfm-architecture.md` — full production architecture (not needed for the demo phase)
- `@tekion-api-access-process.md` — API access steps, running in parallel
- `@CountdownScreen.tsx` — pre-call countdown component