import { describe, it, expect } from "vitest";
import {
  processControllerTurn,
  getOrCreateCallState,
  resetCallState,
  BEATS,
  splitIntoSentences,
  type ControllerDecision,
} from "./beat-controller";
import * as maxLines from "./max-lines";
import kbData from "./max-knowledge-base.json";

// Build corpus of approved text snippets (normalized lower-case for fuzzy sentence matching)
const approvedCorpus: string[] = [];

// 1. All beats text, check-ins, and recaps
BEATS.forEach((b) => {
  approvedCorpus.push(b.text.toLowerCase());
  if (b.check_in) approvedCorpus.push(b.check_in.toLowerCase());
});

// 2. All exported lines from max-lines.ts
Object.values(maxLines).forEach((val) => {
  if (typeof val === "string") {
    approvedCorpus.push(val.toLowerCase());
  } else if (typeof val === "object" && val !== null) {
    Object.values(val).forEach((nested) => {
      if (typeof nested === "string") approvedCorpus.push(nested.toLowerCase());
    });
  }
});

// 3. All facts and rules from max-knowledge-base.json
if (kbData && kbData.facts) {
  kbData.facts.forEach((f: any) => {
    if (f.answer) approvedCorpus.push(f.answer.toLowerCase());
    if (f.topic) approvedCorpus.push(f.topic.toLowerCase());
  });
}

// 4. Approved bridges and connectors
const approvedBridges = [
  "now, back to where we were",
  "back to where we were",
  "no problem, thanks for letting me know",
  "i understand. i'll end this session now",
  "did you get a chance to take it for a test drive",
  "did the salesperson do the walkaround with you",
  "did the salesperson go over the warranty with you",
  "does that work for you",
  "does that make sense",
  "is that okay with you",
  "just to confirm",
  "let me check the connection",
  "what part of the coverage can i clarify",
  "which components are most important to you",
  "which components would you prefer to keep",
  "what question can i answer",
  "three dollars a day is our absolute hard floor",
];

function isSentenceApproved(sentence: string): boolean {
  const norm = sentence
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm || norm.length < 4) return true;

  // Check against approved bridges
  if (approvedBridges.some((b) => norm.includes(b) || b.includes(norm))) {
    return true;
  }

  // Check against corpus
  return approvedCorpus.some((corpusText) => {
    const normCorpus = corpusText
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normCorpus.includes(norm) || norm.includes(normCorpus);
  });
}

function freshSession(startBeat: number) {
  const sid = `weird_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = startBeat;
  st.delivered_beats = Array.from({ length: startBeat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === startBeat)?.text ?? "";
  return sid;
}

interface HostileTestCase {
  id: number;
  beat: number;
  customerSaid: string;
  category: string;
}

// 40 hostile cases from requirements
const HOSTILE_CASES: HostileTestCase[] = [
  // Interruptions
  { id: 1, beat: 6, customerSaid: "Hold on a minute!", category: "interruption" },
  { id: 2, beat: 7, customerSaid: "Wait what?", category: "interruption" },
  { id: 3, beat: 8, customerSaid: "Stop talking for a second.", category: "interruption" },
  { id: 4, beat: 9, customerSaid: "Excuse me, listen to me.", category: "interruption" },
  { id: 5, beat: 12, customerSaid: "Hang on, let me finish.", category: "interruption" },

  // Fillers & Ambiguous
  { id: 6, beat: 2, customerSaid: "Hmm.", category: "filler" },
  { id: 7, beat: 3, customerSaid: "Uh...", category: "filler" },
  { id: 8, beat: 5, customerSaid: "Well...", category: "filler" },
  { id: 9, beat: 6, customerSaid: "Maybe, I don't know.", category: "filler" },
  { id: 10, beat: 7, customerSaid: "Whatever.", category: "filler" },

  // Off-topic & Irrelevant
  { id: 11, beat: 7, customerSaid: "What's the weather like outside?", category: "off_topic" },
  { id: 12, beat: 8, customerSaid: "Did you watch the football game yesterday?", category: "off_topic" },
  { id: 13, beat: 9, customerSaid: "Are you eating lunch right now?", category: "off_topic" },
  { id: 14, beat: 10, customerSaid: "I really love pepperoni pizza.", category: "off_topic" },
  { id: 15, beat: 11, customerSaid: "Who made you?", category: "off_topic" },

  // Hostile / Pushback / Accusations
  { id: 16, beat: 7, customerSaid: "That's ridiculous.", category: "hostile" },
  { id: 17, beat: 8, customerSaid: "That's not true at all.", category: "hostile" },
  { id: 18, beat: 9, customerSaid: "I don't believe a word you're saying.", category: "hostile" },
  { id: 19, beat: 10, customerSaid: "You're lying to me.", category: "hostile" },
  { id: 20, beat: 13, customerSaid: "This is completely boring, shut up.", category: "hostile" },

  // Identity / "Are you a robot?"
  { id: 21, beat: 1, customerSaid: "Are you a robot?", category: "identity" },
  { id: 22, beat: 2, customerSaid: "Are you an AI or a real person?", category: "identity" },
  { id: 23, beat: 6, customerSaid: "You sound like a machine.", category: "identity" },
  { id: 24, beat: 8, customerSaid: "Is this whole call an automated bot?", category: "identity" },
  { id: 25, beat: 9, customerSaid: "Who am I even talking to right now?", category: "identity" },

  // Silence-like / Fragments / Typos
  { id: 26, beat: 2, customerSaid: "uh", category: "fragment" },
  { id: 27, beat: 3, customerSaid: "huh?", category: "fragment" },
  { id: 28, beat: 4, customerSaid: "what?", category: "fragment" },
  { id: 29, beat: 5, customerSaid: "yeah uh...", category: "fragment" },
  { id: 30, beat: 6, customerSaid: "so...", category: "fragment" },

  // Vehicle Corrections
  { id: 31, beat: 2, customerSaid: "It's a CX-30, not a CX-5.", category: "vehicle_correction" },
  { id: 32, beat: 2, customerSaid: "Wait, I bought a Mazda 3, not a CX-5.", category: "vehicle_correction" },

  // Out of script / Financial terms
  { id: 33, beat: 6, customerSaid: "What is my interest rate?", category: "financial" },
  { id: 34, beat: 7, customerSaid: "Can I get 0 percent APR on this loan?", category: "financial" },
  { id: 35, beat: 8, customerSaid: "What did you charge for the doc fee?", category: "financial" },
  { id: 36, beat: 9, customerSaid: "What will my monthly car payment be?", category: "financial" },

  // Exclusions & Custom parts
  { id: 37, beat: 17, customerSaid: "I don't need tires, I buy my own tires.", category: "exclusion" },
  { id: 38, beat: 18, customerSaid: "I do my own oil changes in my garage.", category: "exclusion" },
  { id: 39, beat: 22, customerSaid: "What if I drop the tires from the package?", category: "exclusion" },
  { id: 40, beat: 22, customerSaid: "I can only do twenty dollars a month.", category: "floor_push" },
];

// Extra real failed call utterances from logs-heygen
const REAL_FAILED_LOG_CASES = [
  { id: 41, beat: 1, customerSaid: "Wait, hold on a second! Why are you recording me, who is this?", category: "real_log" },
  { id: 42, beat: 1, customerSaid: "I don't want to be recorded.", category: "real_log" },
  { id: 43, beat: 2, customerSaid: "Let me make you clear, is this a sales score or not? Just let me know.", category: "real_log" },
  { id: 44, beat: 2, customerSaid: "Honestly, I've been waiting at this dealership for three hours.", category: "real_log" },
  { id: 45, beat: 9, customerSaid: "I want to speak with a human manager right now.", category: "real_log" },
  { id: 46, beat: 9, customerSaid: "I'm going to hang up.", category: "real_log" },
];

describe("Task 5 — Weird-Customer Rehearsal Suite", () => {
  const ALL_CASES = [...HOSTILE_CASES, ...REAL_FAILED_LOG_CASES];

  it.each(ALL_CASES)(
    "Case #$id [$category] at Beat $beat: '$customerSaid' never advances without clear yes, never skips beats, speaks grounded text",
    async ({ beat, customerSaid }) => {
      const sid = freshSession(beat);
      const decision: ControllerDecision = await processControllerTurn(sid, customerSaid);

      // 1. Assert Max NEVER advances without a clear yes:
      // None of the hostile cases constitute a clear yes or authorized progression for that beat,
      // so Max must either hold the current beat (decision.beatId === beat) or stop/escalate (state.is_stopped === true).
      if (!decision.state.is_stopped) {
        expect(
          decision.beatId,
          `Adversarial input "${customerSaid}" at Beat ${beat} unexpectedly advanced to Beat ${decision.beatId}!`
        ).toBe(beat);
      }

      // 2. Assert Max NEVER skips a beat
      expect(decision.beatId).toBeLessThanOrEqual(beat + 1);

      // 3. Assert every sentence spoken derives strictly from approved sources
      const sentences = splitIntoSentences(decision.textToSpeak);
      for (const sentence of sentences) {
        const approved = isSentenceApproved(sentence);
        expect(
          approved,
          `Unapproved or hallucinatory sentence spoken for "${customerSaid}": "${sentence}"`
        ).toBe(true);
      }
    }
  );
});
