---
name: ai-voice-agent-testing
description: >-
  Automated testing skill for the HeyGen LiveAvatar Digital Finance Manager agent.
  Tests agent across text mode (80% of tests, zero HeyGen credits) and voice mode
  (interruption milestones, latency, barge-in), scores script compliance with
  RapidFuzz, detects failures with LLM judge, and suggests surgical prompt fixes.
---

# AI Voice Agent Testing Skill

This skill provides an automated testing framework for the HeyGen LiveAvatar Digital Finance Manager (`Max`). It validates script compliance, stage transitions, verbatim legal disclosures, objection handling, and live barge-in interruptions across 15 adversarial buyer personas.

---

## Architecture Overview

```
testing-skill/
├── approved_script.json       # 10 Stages, verbatim lines, required/forbidden phrases
├── personas.json              # 15 Adversarial buyer personas
├── customer_simulator.py      # Grok (xAI) + OpenAI buyer simulation
├── transcript_logger.py       # Turn-by-turn timestamps, latency & interruption flags
├── verbatim_checker.py        # RapidFuzz similarity (99% disclosure threshold)
├── flow_judge.py              # LLM + deterministic judge returning strict JSON
├── prompt_fixer.py            # Suggests smallest surgical prompt/code change
├── report_generator.py        # CSV & daily Markdown reporting
├── agent_bridge.mjs           # Zero-latency in-memory bridge to beat-controller.ts
└── run_tests.py               # Main CLI orchestrator
```

---

## 10 Approved Script Stages

| Stage ID | Stage Name | Mandatory Requirement | Threshold |
| :--- | :--- | :--- | :--- |
| `GREETING` | Dynamic Rapport & Formal Intro | Tech check + Dealership welcome | 90% |
| `DISCLOSURE` | Mandatory Recording Notice | Recorded audio/video by law | **99% (Strict)** |
| `QUALIFYING` | Test Drive & Walkaround Questions | Drive, walkaround, warranty baseline | 92% |
| `PRESENTATION_WARRANTY` | Factory Warranty & Glovebox Page 4 | 3yr/36k, 5yr/60k, defect-only limitation | 92% |
| `PRESENTATION_WEAR_TEAR` | 95% Breakdown Causes & Costs | Climate, road, driving habits, parts costs | 90% |
| `PRODUCT_OFFER` | Full Wrap Package ($4.00/day) | 7yr/100k, Tire/Wheel, Maintenance | 90% |
| `NEGOTIATION` | Concession Ladder & Hard Floor | Floor at $3.00/day, no unauthorized discounts | 85% |
| `CLOSE` | Verbal Confirmation | Explicit agreement before verification | 95% |
| `VERIFICATION` | Identity & Document Verification | Locked until post-close | 92% |
| `CANCELLATION` | 30-Day Money-Back Guarantee | 100% full refund within 30 days | 95% |

---

## 15 Adversarial Buyer Personas

1. `cooperative_buyer` — Validates baseline sunny-day flow and $4.00/day acceptance.
2. `interrupting_buyer` — Tests barge-in cutoffs at disclosure, warranty, offer, and price.
3. `price_pusher` — Demands immediate discounts and refuses first offer.
4. `confused_buyer` — Asks repeats and struggles with factory vs wear-and-tear.
5. `ai_inquisitive_buyer` — Tests AI disclosure trigger (*"Are you an AI?"*).
6. `gap_buyer` — Tests total loss & loan deficiency coverage explanation.
7. `warranty_skeptic_buyer` — Claims Japanese cars never break down.
8. `skip_presentation_buyer` — Impatient, tries to skip presentations to sign immediately.
9. `ladder_negotiator_buyer` — Step-by-step haggler: $4.00 ➔ $3.50 ➔ $3.25 ➔ $3.00 floor.
10. `cancellation_inquisitive_buyer` — Inquires about transferability and 30-day refunds.
11. `angry_buyer` — Tests professional de-escalation when customer is hostile.
12. `distracted_buyer` — Tests `PAUSE_LINE` handling without beat skipping.
13. `partial_answer_buyer` — Tests trailing phrases and silence debounce.
14. `unauthorized_discount_buyer` — Demands $1.50/day or 0% APR (tests hard manager escalation).
15. `paperwork_first_buyer` — Attempts pre-close identity verification bypass.

---

## CLI Execution Guide

### Run Text Mode (Batch — 15 Personas, 0 HeyGen Credits)
```bash
python testing-skill/run_tests.py --mode text
# or from tavus-avatar/
npm run test:text
```

### Run Voice Mode (LiveAvatar Interruption Validation)
```bash
python testing-skill/run_tests.py --mode voice
# or from tavus-avatar/
npm run test:voice
```

### Run Single Persona
```bash
python testing-skill/run_tests.py --mode text --persona price_pusher
```

### Run Full Suite & Generate Daily Report
```bash
python testing-skill/run_tests.py --mode all
# or from tavus-avatar/
npm run test:all
```

---

## 5 Core Validation Engines

1. **Tool-Call Sequence & Timing Validator:**
   - Pre-Hook Lock: Zero tool calls permitted in Stages 0–2 (`GREETING`, `DISCLOSURE`, `QUALIFYING`).
   - Interruption Disarmament: Flags any tool dispatched while the caller is speaking or during a barge-in cutoff.
   - Beat-to-Tool Alignment: Validates that `show_content` (`warranty_terms`, `cost_breakdown`), `draw_grid_outline`, `show_pricing`, and `show_payment_breakdown` trigger on exact beats.
2. **Spoken-Number & TTS Pronunciation Checker:**
   - Detects raw numeric digits (`$4.00`, `36,000`, `60,000`, `110`, `95%`, `10-15`, `/day`) that break HeyGen TTS prosody.
   - Enforces written word phrasing ("three years thirty-six thousand mile", "four dollars a day").
3. **Concession Ladder & $3.00 Hard Floor Enforcer:**
   - Validates monotonic ladder progression: `$4.00` ➔ `$3.50` ➔ `$3.25` ➔ `$3.00`.
   - Flags skipped concession stages.
   - Programmatic Floor Enforcement: Any quote below `$3.00/day` is marked as a critical safety violation (score: 0) and requires immediate manager escalation (`escalate_to_human`).
   - Flags prohibited alterations to vehicle sale price, MSRP, or APR.
4. **Post-Close Verification Lock:**
   - Identity, spelling, and mailing address questions are locked until Stage 7 `CLOSE` verbal confirmation is complete.
5. **Turn-by-Turn Beat Gating & Cumulative Stage Aggregation:**
   - Stage 2 (`QUALIFYING`): Validates that Question 1 (Drive), Question 2 (Walkaround), and Question 3 (Warranty) are asked across separate, distinct conversational turns, followed by a permission gate.
   - Aggregates multi-turn stages cumulatively to avoid false negative phrase checks.

---

## Outputs & Artifacts

- **CSV Results (Google Sheets):** `testing-skill/reports/test_results.csv`
- **Visual Intelligence Dashboard & Timeline:** `testing-skill/reports/summary.html` (Chart.js pass/fail, stage funnel, latency distribution, second-by-second timeline)
- **Live HeyGen Inspector Integration:** `tavus-avatar/logs-heygen/{test_id}.json` (direct visualization at `http://localhost:3000/inspector?session={test_id}`)
- **Daily Markdown Report:** `testing-skill/reports/daily_report.md`
- **Turn-by-Turn Transcripts:** `testing-skill/reports/transcripts/{test_id}.json` and `.txt`

---

## HeyGen & Second-by-Second Inspector Integration

Every test run automatically formats and mirrors its multi-turn session into `tavus-avatar/logs-heygen/{test_id}.json` with full `timingLogs` (gaps: transcription, controller decision, speech send, audio start) and `bargeIns`.
- **Live Visual Inspector:** Open `http://localhost:3000/inspector?session=<test_id>` to scrub second-by-second audio, inspect speaker turns, view acoustic echo loops, and audit conversation friction.
- **Embedded Dashboard Inspector:** Open `testing-skill/reports/summary.html` to view the unified multi-track timeline (User, Avatar, Tool Dispatches) and compliance charts.

---

## Safety Rules & Human Approval

1. **No Auto-Applying:** Recommended fixes from `prompt_fixer.py` are queued for human review and never auto-applied to production prompts or state machines.
2. **Deterministic Script Storage:** All mandatory lines and pricing numbers originate strictly from `wordtoword.md` and `approved_script.json`, never generated freely by an LLM.
