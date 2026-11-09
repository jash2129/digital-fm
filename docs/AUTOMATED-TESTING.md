# Automated testing of Max

Two layers run without testers. Both score calls with the same checklist
(`tavus-avatar/src/lib/call-scorecard.ts`):

| Check | Type | Fails when |
|---|---|---|
| Max never loops | hard | the same line 3 times in a row, or a substantive line 3 times in a call |
| Never jumps back to the start | hard | the opener comes back after the recording disclosure |
| Fragments are not answers | hard | a lone non-answer word ("up", "there") moves the script on |
| Only approved prices, never under $3 | hard | Max states a daily price outside $4 / $3.50 / $3.25 / $3 |
| A 'no' to the price gets a lower price | hard | "no" at the offer gets the same pitch again |
| Re-asks are not word for word | soft | the same line twice in a row (sounds robotic) |
| Rarely has to say he didn't understand | soft | more than 2 "didn't catch that" / "continue or go over that again" lines |
| Never stuck on one beat | soft | 6 customer turns on the same beat |

**Hard** = a real failure. **Soft** = quality, reported but not blocking.

Run everything below from `tavus-avatar/`.

## Layer 1: AI customers (simulated calls)

An AI plays each customer in `testing-skill/tester-personas.json` (modelled on the real testers)
against the real Max logic, then every call is scored and reviewed.

```
npx --yes tsx --conditions=react-server scripts/sim-batch.ts --calls 40
```

- `--personas terse_tester,hard_haggler` to run only some personas
- `--noise 0.15` turns 15% of customer turns into recognition glitches (a cut-off fragment or an
  echo of Max's words), as in the real calls; default 10%
- **Every simulated call is sent to the call log sheet** (Environment `local · simulation (<persona>)`,
  with the AI review columns filled). `--no-sheet` skips that for a run. Each call uses about 5 Make
  operations: a 40-call batch is about 200 of the free plan's 1,000 a month.
- `--resend testing-skill/reports/sim-batch-<time>.json` sends a past batch to the sheet
- `--no-review` skips the AI review in the report (the sheet row still gets one)
- Simulated calls have no recording or Inspector page; the Inspector Link column says so

Report: `testing-skill/reports/sim-batch-<time>.md`. Needs `XAI_API_KEY` or `OPENAI_API_KEY` in
`.env.local`; a 40-call run costs well under a dollar of AI usage.

What it cannot test: voice, echo, lag and turn-taking (it is text only), and how real people mumble.

## Layer 2: replay real calls

Every real call's customer lines, replayed in order against today's Max:

```
npx --yes tsx --conditions=react-server scripts/replay-real-calls.ts --csv "<call log sheet export>.csv" --save-fixture
npx --yes tsx --conditions=react-server scripts/replay-real-calls.ts --api https://digital-fm.vercel.app --save-fixture
```

`--api` reads the stored calls from the live app (needs `DEMO_API_TOKEN` in `.env.local`).
`--save-fixture` adds the calls to `testing-skill/real-calls/real-calls.json`, which
`npm test` replays every time (`src/lib/real-calls-replay.test.ts`): if a real call's failure comes
back, the test suite fails. Report: `testing-skill/reports/replay-<time>.md`.

Replays feed yesterday's answers to today's questions, so "didn't understand" lines show up more
than they would in a real call: judge those soft flags with that in mind.

## Suggested routine

1. After a code change: `npm test` (includes the real-call replay).
2. Before a test round: `sim-batch.ts --calls 40`, fix the hard failures, run again.
3. After a test round: export the sheet as CSV and run `replay-real-calls.ts --csv … --save-fixture`.
