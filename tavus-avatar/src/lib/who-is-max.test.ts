/**
 * "Who are you?" (2026-11-25): reported skipped about 1 in 4 when it landed on the turn the disclosure
 * was due. Every phrasing is recognised, the answer is guaranteed on every path (ensureWhoAnswered),
 * and consent is never asked for a disclosure that was not said (ensureDisclosure).
 */
import { describe, it, expect } from "vitest";
import {
  processControllerTurn,
  resetCallState,
  getOrCreateCallState,
  whoIsMaxAnswer,
  ensureWhoAnswered,
  ensureDisclosure,
  type ControllerDecision,
} from "./beat-controller";
import { IDENTITY_LINE, AI_DISCLOSURE_LINE, ROLE_EXPLAIN_LINE } from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);
function newCall() {
  const sid = `who_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  return sid;
}
const ANSWERED = /I'm Max|I'm an AI|finance manager/i;

describe("recognising the question", () => {
  it("every phrasing from the calls", () => {
    for (const t of ["Who are you?", "who is this", "What's your name?", "and you are?", "Who am I talking to?", "Sorry, who's this?", "who"]) expect(whoIsMaxAnswer(t), t).toBe(IDENTITY_LINE);
    for (const t of ["Are you a real person?", "is this a robot", "am I talking to a human?"]) expect(whoIsMaxAnswer(t), t).toBe(AI_DISCLOSURE_LINE);
    expect(whoIsMaxAnswer("What do you do?")).toBe(ROLE_EXPLAIN_LINE);
    for (const t of ["yes", "what does that cover?", "who pays for it?", "it's been good"]) expect(whoIsMaxAnswer(t), t).toBeNull();
  });
});

describe("on the turn the disclosure is due", () => {
  it("'Good, who are you?': who Max is, then the disclosure (not the experience question again)", async () => {
    for (const q of ["Good, who are you?", "It's been great. What's your name?", "Fine. And you are?", "I'm good, who's this"]) {
      const sid = newCall();
      await say(sid, "Yes, I can hear and see you");
      const d = await say(sid, q);
      expect(d.textToSpeak, q).toMatch(ANSWERED);
      expect(d.textToSpeak, q).toMatch(/recorded audio and video/);
      expect(d.beatId, q).toBe(1);
    }
  });

  it("'Wait, who are you again?' is not a complaint about waiting", async () => {
    const sid = newCall();
    await say(sid, "Yes, I can hear and see you");
    const d = await say(sid, "It was okay. Wait, who are you again?");
    expect(d.textToSpeak).not.toMatch(/long wait/i);
    expect(d.textToSpeak).not.toMatch(/Glad to hear/);
  });

  it("answered on every turn of the greeting, 0 skipped", async () => {
    const qs = ["who are you", "What's your name?", "and you are?", "Are you a real person?", "What do you do?"];
    for (const lead of [[], ["Yes, I can hear and see you"]]) {
      for (const q of qs) {
        const sid = newCall();
        for (const l of lead) await say(sid, l);
        expect((await say(sid, q)).textToSpeak, `${lead.length} ${q}`).toMatch(ANSWERED);
      }
    }
  });
});

const decision = (text: string, beat: number, extra: Partial<ReturnType<typeof getOrCreateCallState>> = {}): ControllerDecision => {
  const sid = newCall();
  const st = getOrCreateCallState(sid);
  Object.assign(st, { step0_completed: true, current_beat: beat, last_spoken_text: "", ...extra });
  return { textToSpeak: text, beatId: beat, beatType: "wait", toolCalls: [], state: st, intent: "other" } as ControllerDecision;
};

describe("guards on every path (script, AI wording, free mode)", () => {
  it("an AI-worded reply that skipped the answer gets it first", () => {
    const d = decision("Let's keep going with the warranty.", 9);
    ensureWhoAnswered(d, "wait, who are you?");
    expect(d.textToSpeak).toBe(`${IDENTITY_LINE} Let's keep going with the warranty.`);
    const ok = decision("I'm Max, your digital finance manager today. Anyway…", 9);
    ensureWhoAnswered(ok, "who are you?");
    expect(ok.textToSpeak.startsWith("I'm Max, your digital finance manager today. Anyway")).toBe(true);
  });

  it("consent is never asked for a disclosure that was not said", () => {
    const d = decision(`${AI_DISCLOSURE_LINE} Is that okay with you?`, 1);
    ensureDisclosure(d);
    expect(d.textToSpeak.startsWith(AI_DISCLOSURE_LINE)).toBe(true);
    expect(d.textToSpeak).toMatch(/recorded audio and video/);
    expect(d.state.disclosure_said).toBe(true);
  });

  it("once the disclosure was said, the consent question stays as it is", () => {
    const d = decision(`${AI_DISCLOSURE_LINE} Is that okay with you?`, 1, { last_spoken_text: "…this transaction is recorded audio and video, also…" });
    ensureDisclosure(d);
    expect(d.textToSpeak).toBe(`${AI_DISCLOSURE_LINE} Is that okay with you?`);
  });
});
