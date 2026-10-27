Build an AI Voice Agent Testing Skill for my existing HeyGen LiveAvatar digital finance manager agent.

GOAL:
Create an automated testing system that tests my agent in BOTH text mode and voice mode, generates transcripts, scores script compliance, detects failures, and recommends the smallest prompt/state-machine fix.

TECH STACK:
- HeyGen LiveAvatar for the avatar/voice layer
- OpenAI API for agent brain, judge model, and fix recommendations
- Grok API for adversarial customer simulation
- Python or Node.js (choose the best fit for HeyGen/LiveAvatar integration)
- RapidFuzz for verbatim script checking
- CSV/Google Sheets-compatible output
- Simple local dashboard or Markdown report

IMPORTANT ARCHITECTURE:

1. TEXT TESTING MODE (80% of tests)
- Simulate customer-agent conversation using text only.
- Test: stage order, skipped stages, verbatim disclosure, required facts, wrong claims, objection handling, hallucinations, and prompt logic.
- Do not use HeyGen credits for text tests.
- Run at least 10 customer personas in batch.

2. VOICE TESTING MODE (final validation)
- Use HeyGen LiveAvatar session for real voice calls.
- Test: interruptions, barge-in, latency, avatar stop/resume behavior, speech recognition, and screen-share timing.
- Customer AI must interrupt at predefined points:
  a) During disclosure
  b) During warranty explanation
  c) During product offer
  d) During price negotiation
- Capture full transcript, audio/video if available, per-turn latency, interruption result, and final pass/fail.

3. APPROVED SCRIPT ENGINE
- Create `approved_script.json` with stages:
  GREETING, DISCLOSURE, QUALIFYING, PRESENTATION_WARRANTY, PRESENTATION_WEAR_TEAR, PRODUCT_OFFER, NEGOTIATION, CLOSE, VERIFICATION, CANCELLATION.
- Each stage must contain:
  - stage_id
  - mandatory verbatim lines
  - required_phrases
  - forbidden_phrases
  - allowed next stages
  - customer personas
  - expected outcome
- Disclosure, verification, pricing, and product claims must use strict verbatim or near-verbatim checks.
- Use exact matching first, then RapidFuzz similarity.
- Disclosure threshold: 99% similarity.
- Product explanation threshold: required phrases must all be present.

4. AI TEST ROLES
Create separate modules:
- customer_simulator.py/js: uses Grok to play buyer personas.
- transcript_logger.py/js: saves full conversation.
- verbatim_checker.py/js: code-based exact/fuzzy script compliance.
- flow_judge.py/js: uses OpenAI to evaluate stage flow, hallucinations, interruptions, and compliance.
- prompt_fixer.py/js: uses OpenAI to suggest only the smallest prompt/state-machine change.
- report_generator.py/js: creates CSV + Markdown report.

5. CUSTOMER PERSONAS
Create at least 15 personas:
- Cooperative buyer
- Interrupting buyer
- Price pusher
- Confused buyer
- Buyer asking “Are you AI?”
- Buyer asking about GAP
- Buyer asking about warranty
- Buyer asking to skip presentation
- Buyer pushing price from $4 to $3.50 to $3
- Buyer asking about cancellation
- Angry buyer
- Distracted buyer
- Buyer giving partial answers
- Buyer asking unauthorized discount
- Buyer trying to move to paperwork before presentation

6. JUDGE PROMPT
The flow judge must return strict JSON:
{
  "test_id": "",
  "mode": "text|voice",
  "stage_reached": "",
  "stage_order_correct": true/false,
  "missing_stages": [],
  "verbatim_failures": [],
  "unapproved_claims": [],
  "hallucinations": [],
  "interruption_handled": true/false,
  "latency_issues": [],
  "customer_goal_completed": true/false,
  "overall_score": 0-100,
  "root_cause": "prompt|state_machine|knowledge_base|tool|latency|avatar",
  "smallest_fix": ""
}

7. REPORTING
Generate:
- `reports/test_results.csv`
- `reports/daily_report.md`
- Per-test transcript files
- Pass/fail summary
- Top 5 failures
- Before/after score comparison

8. COMMANDS
Create CLI commands:
- `npm run test:text` or `python run_tests.py --mode text`
- `npm run test:voice` or `python run_tests.py --mode voice`
- `npm run test:all`
- `npm run report`

9. SAFETY RULES
- Never let the LLM freely generate disclosure, legal, pricing, warranty coverage, or product claims.
- Mandatory lines must come from approved templates.
- The agent should retrieve and speak approved script blocks, not paraphrase them.
- Do not auto-apply prompt changes; generate recommendations for human approval.

START BY:
1. Creating the project structure.
2. Creating `approved_script.json` with placeholder approved script content.
3. Creating customer personas.
4. Building text-mode testing first.
5. Then adding HeyGen voice-mode testing.
6. Then generating reports.

Ask me for the HeyGen LiveAvatar API details, existing agent endpoint, and approved script JSON only if required. Otherwise, build the complete scaffold now.