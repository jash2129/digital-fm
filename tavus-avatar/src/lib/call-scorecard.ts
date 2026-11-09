/**
 * Pass/fail checks for one call, from the client's point of view: Max never loops or jumps back to
 * the start, does not take a one-word fragment as an answer, follows the approved price ladder and
 * never goes under the floor, and gets the customer somewhere. Used by the simulated-call batch
 * (scripts/sim-batch.ts), the real-call replay (scripts/replay-real-calls.ts) and the regression test.
 *
 * Pure: works on turns (what the customer said, what Max said, the beat after) only.
 */
import { isPlainNo } from "./beat-controller";

export interface ScoredTurn {
  customer: string;
  max: string;
  /** Beat after Max's reply (0 = Step 0, before the recording disclosure) */
  beat: number;
}

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  /** hard: a real failure (the regression test requires it). soft: quality, reported only */
  severity: "hard" | "soft";
  /** Where it went wrong, quoting the moment */
  detail?: string;
}

export interface Scorecard {
  checks: Check[];
  passed: number;
  failed: number;
  furthestBeat: number;
  reachedPrice: boolean;
  completed: boolean;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const short = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n)}…` : t);

// Lines that belong to Step 0 only: hearing them after the disclosure means the call restarted
const STEP0_MARKERS = ["great to connect with you", "can you hear and see me", "how has your experience been with our team"];
// Max's generic recovery lines: he did not understand, or the line went quiet
const RECOVERY_STARTS = ["sorry i didn t catch that", "would you like me to continue or go over that again", "are you still with me"];
const isRecovery = (normalized: string) => RECOVERY_STARTS.some((r) => normalized.startsWith(r));

// Words that can be a whole answer on their own (mirrors the controller's list)
const ONE_WORD_ANSWERS = new Set(
  ("yes yeah yep yup ya yea yah aye ok okay k sure fine right correct true absolutely definitely certainly " +
    "alright good great perfect awesome cool nice excellent no nope nah never maybe proceed continue next " +
    "go understood understand gotcha agreed agree deal done ready mhm hmm hm uh um thanks thank").split(" ")
);

/** Every daily amount Max states, in dollars ("four dollars", "three dollars and fifty cents", "$3.25") */
export function statedDailyAmounts(text: string): number[] {
  const t = text.toLowerCase();
  const out: number[] = [];
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  // Only amounts said as a daily price ("… a day"): "twenty five dollar for every oil change" is not one
  for (const m of t.matchAll(/\b(one|two|three|four|five) dollars?(?: and (twenty[- ]five|fifty|seventy[- ]five) cents)?(?= (?:a|per) day)/g)) {
    const cents = m[2] ? (m[2].startsWith("fifty") ? 0.5 : m[2].startsWith("twenty") ? 0.25 : 0.75) : 0;
    out.push(words[m[1]] + cents);
  }
  for (const m of t.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)\s*(?:a day|per day|\/day)/g)) out.push(Number(m[1]));
  return out;
}

export function scoreCall(turns: ScoredTurn[]): Scorecard {
  const checks: Check[] = [];
  const maxLines = turns.map((t) => t.max).filter(Boolean);
  const furthestBeat = turns.reduce((m, t) => Math.max(m, t.beat), 0);

  // 1. A loop: the same line three times in a row, or a long line three times in one call
  {
    let detail: string | undefined;
    for (let i = 2; i < maxLines.length && !detail; i++) {
      const k = norm(maxLines[i]);
      if (k && k === norm(maxLines[i - 1]) && k === norm(maxLines[i - 2])) detail = `said three times in a row: "${short(maxLines[i])}"`;
    }
    // Substantive lines only: recovery lines ("Sorry, I didn't catch that…") recur legitimately
    // across a long call and are counted separately below
    const counts = new Map<string, number>();
    for (const l of maxLines) {
      const k = norm(l);
      if (k.length > 40 && !isRecovery(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) if (!detail && n >= 3) detail = `said ${n} times: "${short(k)}"`;
    checks.push({ id: "no_loop", label: "Max never loops", severity: "hard", pass: !detail, detail });
  }

  // 1b. Re-asking word for word right away sounds robotic (testers noticed it): reported, not blocking
  {
    let detail: string | undefined;
    for (let i = 1; i < maxLines.length && !detail; i++) {
      if (norm(maxLines[i]) && norm(maxLines[i]) === norm(maxLines[i - 1])) detail = `said twice in a row: "${short(maxLines[i])}"`;
    }
    checks.push({ id: "varied_reask", label: "Re-asks are not word for word", severity: "soft", pass: !detail, detail });
  }

  // 1c. How often Max had to say he did not understand ("keeps on repeating", a tester): reported
  {
    const recoveries = maxLines.filter((l) => isRecovery(norm(l))).length;
    checks.push({
      id: "few_recoveries",
      label: "Rarely has to say he didn't understand",
      severity: "soft",
      pass: recoveries <= 2,
      detail: recoveries > 2 ? `${recoveries} "didn't catch that" / "continue or go over that again" lines` : undefined,
    });
  }

  // 2. Never back to the opener once the disclosure was reached
  {
    let reachedBeat1 = false;
    let detail: string | undefined;
    for (const t of turns) {
      if (reachedBeat1 && !detail && STEP0_MARKERS.some((m) => norm(t.max).includes(m))) {
        detail = `after "${short(t.customer, 40)}" Max said "${short(t.max)}"`;
      }
      if (t.beat >= 1) reachedBeat1 = true;
    }
    checks.push({ id: "no_restart", label: "Never jumps back to the start", severity: "hard", pass: !detail, detail });
  }

  // 3. A lone non-answer word never moves the script forward
  {
    let detail: string | undefined;
    let prevBeat = 0;
    for (const t of turns) {
      const w = norm(t.customer).split(" ").filter(Boolean);
      if (!detail && prevBeat >= 1 && w.length === 1 && !ONE_WORD_ANSWERS.has(w[0]) && t.beat > prevBeat) {
        detail = `"${t.customer}" moved Beat ${prevBeat} to ${t.beat}`;
      }
      prevBeat = t.beat;
    }
    checks.push({ id: "fragment_not_answer", label: "Fragments are not answers", severity: "hard", pass: !detail, detail });
  }

  // 4. Never under the $3/day floor, and only approved prices
  {
    const approved = new Set([4, 3.5, 3.25, 3]);
    let detail: string | undefined;
    for (const l of maxLines) {
      for (const a of statedDailyAmounts(l)) if (!detail && !approved.has(a)) detail = `stated $${a}/day: "${short(l)}"`;
    }
    checks.push({ id: "price_approved", label: "Only approved prices, never under $3", severity: "hard", pass: !detail, detail });
  }

  // 5. A plain "no" at the offer gets a lower price, not the same pitch
  {
    let detail: string | undefined;
    for (let i = 1; i < turns.length; i++) {
      const before = turns[i - 1].beat;
      if (!detail && (before === 22 || before === 23) && isPlainNo(norm(turns[i].customer))) {
        const lastPrice = Math.min(4, ...turns.slice(0, i).flatMap((t) => statedDailyAmounts(t.max)));
        const offered = statedDailyAmounts(turns[i].max);
        if (lastPrice > 3 && !offered.some((a) => a < lastPrice)) {
          detail = `"${turns[i].customer}" at $${lastPrice} got: "${short(turns[i].max)}"`;
        }
      }
    }
    checks.push({ id: "ladder_on_no", label: "A 'no' to the price gets a lower price", severity: "hard", pass: !detail, detail });
  }

  // 6. Not stuck: the beat changes within 6 customer turns (Step 0 and the verification beat excepted)
  {
    let detail: string | undefined;
    let run = 1;
    for (let i = 1; i < turns.length; i++) {
      run = turns[i].beat === turns[i - 1].beat ? run + 1 : 1;
      if (!detail && run >= 6 && turns[i].beat >= 1 && turns[i].beat < 25) detail = `${run} turns on Beat ${turns[i].beat}`;
    }
    checks.push({ id: "not_stuck", label: "Never stuck on one beat", severity: "soft", pass: !detail, detail });
  }

  const failed = checks.filter((c) => !c.pass).length;
  return {
    checks,
    passed: checks.length - failed,
    failed,
    furthestBeat,
    reachedPrice: furthestBeat >= 22,
    completed: furthestBeat >= 25,
  };
}
