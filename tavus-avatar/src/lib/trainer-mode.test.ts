/**
 * In-call coaching session (2026-11-24). TXM's notes came in pieces on 22-23 Nov: "Coach mode." was
 * saved as the whole note and the instruction after it was answered as customer speech. A trigger now
 * opens a session: Max opens the floor once, stays silent, joins every piece into one note, and "done"
 * resumes the call. The AI is not involved (rules only).
 */
import { describe, it, expect } from "vitest";
import {
  processControllerTurn,
  resetCallState,
  getOrCreateCallState,
  isCoachFeedback,
  categorizeTrainerFeedback,
  coachingStart,
  isCoachingEnd,
  repromptText,
  BEATS,
} from "./beat-controller";
import { COACH_START_LINE, COACH_MORE_LINE, COACH_DONE_LINE } from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number) {
  const sid = `coach_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  if (beat >= 1) {
    st.step0_completed = true;
    st.current_beat = beat;
    st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
    st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  }
  return { sid, st };
}

describe("what starts coaching", () => {
  it("TXM's real triggers, mishearings included", () => {
    for (const t of ["Coach mode.", "Coach mood. So when you say", "Coach Moon", "Coach moved.", "Coach Max, make sure", "Feedback.", "coach", "[COACH]: explain the warranty to me", "Note for Max: speak slower here", "Don't say you understand.", "coach mode do not ask if i understand just contineo with the presentation"]) {
      expect(isCoachFeedback(t), t).toBe(true);
    }
  });

  it("ordinary customer speech is not coaching", () => {
    for (const t of ["Yes, I can hear you fine", "That's too much money", "Does it cover my battery?", "No thanks, I'll pass", "So instead of you pay the bank", "Coaches are great", "My couch is old", "What does that mean?"]) {
      expect(isCoachFeedback(t), t).toBe(false);
    }
  });

  it("keeps what was said after the trigger in the same breath", () => {
    expect(coachingStart("Coach mode: don't ask if I understand")).toEqual({ rest: "don't ask if I understand", typed: false });
    expect(coachingStart("Coach Max, please keep going.")).toEqual({ rest: "please keep going.", typed: false });
    expect(coachingStart("[COACH]: explain the warranty to me")).toEqual({ rest: "explain the warranty to me", typed: true });
    expect(coachingStart("Coach mode.")).toEqual({ rest: "", typed: false });
  });

  it("what ends it", () => {
    for (const t of ["Done.", "Okay, done", "That's it", "end coaching", "Back to the call.", "Continue", "keep going please"]) expect(isCoachingEnd(t), t).toBe(true);
    for (const t of ["When you say it's misdesigned,", "Don't stop", "I'm done with the car"]) expect(isCoachingEnd(t), t).toBe(false);
  });

  it("categories still work", () => {
    expect(categorizeTrainerFeedback("Speak more warmly and naturally")).toBe("tone");
    expect(categorizeTrainerFeedback("The labor cost is 180 an hour")).toBe("policy_fact");
    expect(categorizeTrainerFeedback("do not ask if I understand, just continue")).toBe("flow");
    expect(categorizeTrainerFeedback("Change that line to keep it simple")).toBe("phrasing");
  });
});

describe("a coaching session in a call", () => {
  it("replay of the 23 Nov call: the pieces after 'Coach mood' become ONE note and Max stays silent", async () => {
    const { sid, st } = atBeat(7);
    const opened = await say(sid, "Coach mood. So when you say");
    expect(opened.textToSpeak).toBe(COACH_START_LINE);
    for (const piece of ["misinstalled,", "Listen. I'm trying", "you say so it's a defect"]) {
      const d = await say(sid, piece);
      expect(d.textToSpeak, piece).toBe("");
      expect(d.beatId).toBe(7);
    }
    const resumed = await say(sid, "Done.");
    expect(resumed.textToSpeak.startsWith(COACH_DONE_LINE)).toBe(true);
    expect(resumed.beatId).toBe(8); // during an explanation Max carries on
    expect(st.coaching).toBeUndefined();
    expect(st.trainer_feedback).toHaveLength(1);
    expect(st.trainer_feedback![0]).toMatchObject({ beat: 7, feedback: "So when you say misinstalled, Listen. I'm trying you say so it's a defect", parts: 4 });
    expect(st.trainer_feedback![0].last_spoken).toContain("defect");
  });

  it("a full note in one breath gets 'anything else?', not the open-floor line", async () => {
    const { sid } = atBeat(9);
    const d = await say(sid, "coach mode do not ask if i understand just continue with the presentation");
    expect(d.textToSpeak).toBe(COACH_MORE_LINE);
  });

  it("no 'Are you still with me?' while the trainer is mid-note", async () => {
    const { sid } = atBeat(9);
    await say(sid, "Coach Max");
    expect(repromptText(sid, "still_with_me")).toBe("");
    expect(repromptText(sid, "resume")).toBe("");
  });

  it("typed coaching ends at the first untagged message, which is then an ordinary turn", async () => {
    const { sid, st } = atBeat(9);
    expect((await say(sid, "[COACH]: explain the warranty to me")).textToSpeak).toBe(COACH_MORE_LINE);
    expect((await say(sid, "[COACH]: and keep it short")).textToSpeak).toBe("");
    const normal = await say(sid, "okay");
    expect(normal.intent).not.toBe("coach_feedback");
    expect(st.trainer_feedback![0].feedback).toBe("explain the warranty to me and keep it short");
  });

  it("after 30 s with nothing more, the next words are an ordinary turn and the note is kept", async () => {
    const { sid, st } = atBeat(9);
    await say(sid, "Coach mode, speak more slowly here");
    st.coaching!.lastAt = Date.now() - 31_000;
    const d = await say(sid, "okay");
    expect(d.intent).not.toBe("coach_feedback");
    expect(st.coaching).toBeUndefined();
    expect(st.trainer_feedback![0].feedback).toBe("speak more slowly here");
  });

  it("at the recording consent, coaching never counts as the customer's yes", async () => {
    const { sid, st } = atBeat(1);
    await say(sid, "Coach Max, make sure");
    await say(sid, "this transaction is recorded is said clearly");
    const resumed = await say(sid, "done");
    expect(resumed.beatId).toBe(1);
    expect(st.current_beat).toBe(1);
    expect(resumed.textToSpeak.startsWith(COACH_DONE_LINE)).toBe(true);
    expect(resumed.textToSpeak).toMatch(/\?$/);
  });

  it("in the greeting (Step 0): back to the greeting question, Step 0 not skipped", async () => {
    const { sid, st } = atBeat(0);
    await say(sid, "Note for Max: your greeting was too fast");
    const resumed = await say(sid, "done");
    expect(st.step0_completed).toBe(false);
    expect(resumed.textToSpeak.startsWith(COACH_DONE_LINE)).toBe(true);
    expect((await say(sid, "Yes, I can hear and see you fine")).intent).toBe("step0");
  });

  it("'Coach mode' and then 'done' with nothing said keeps no empty note", async () => {
    const { sid, st } = atBeat(12);
    await say(sid, "Coach mode.");
    await say(sid, "done");
    expect(st.trainer_feedback ?? []).toHaveLength(0);
  });

  it("coaching pieces never count as misses: the beat holds however many there are", async () => {
    const { sid } = atBeat(12);
    await say(sid, "Coach mode");
    for (const p of ["first", "second", "third", "fourth"]) expect((await say(sid, p)).beatId).toBe(12);
  });
});
