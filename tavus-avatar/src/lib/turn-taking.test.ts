/**
 * Turn-taking unit tests (follow-up 6, from live session 1ee5181b). Fake timers drive the
 * controller exactly as the browser would: speech recognizer -> controller -> request -> speech.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TurnController, isLoneFiller, type TurnLogEvent } from "./turn-taking";

function harness(opts: { requestMs?: number } = {}) {
  const requestMs = opts.requestMs ?? 1500;
  const sent: string[] = [];
  const logs: TurnLogEvent[] = [];
  const s = { speaking: false, stoppedAt: 0 };
  const controller = new TurnController({
    runTurn: (t) => {
      sent.push(t);
      return new Promise((r) => setTimeout(r, requestMs));
    },
    isAvatarSpeaking: () => s.speaking,
    avatarStoppedAt: () => s.stoppedAt,
    isEcho: (t) => t.toLowerCase().includes("congratulations on your"),
    log: (e) => logs.push(e),
  });
  return { controller, sent, logs, s };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("P2: customer speech is never silently dropped", () => {
  it("(b) a transcript arriving during a request is processed after it finishes", async () => {
    const { controller, sent, logs } = harness({ requestMs: 2000 });
    controller.onTranscript("I drove it yesterday");
    await vi.advanceTimersByTimeAsync(500);
    controller.onTranscript("what was the question about the warranty");
    expect(sent).toEqual(["I drove it yesterday"]);
    expect(logs.at(-1)).toMatchObject({ event: "transcript_parked", reason: "request_in_flight" });

    await vi.advanceTimersByTimeAsync(2000); // first request finishes
    await vi.advanceTimersByTimeAsync(1000); // past the post-speech guard
    expect(sent).toEqual(["I drove it yesterday", "what was the question about the warranty"]);
    expect(logs.some((e) => e.event === "pending_replayed")).toBe(true);
  });

  it("a line said while Max is speaking is replayed once he stops", async () => {
    const { controller, sent, s } = harness();
    s.speaking = true;
    controller.onTranscript("why aren't you asking questions");
    expect(sent).toEqual([]);
    s.speaking = false;
    s.stoppedAt = Date.now();
    controller.notifyIdle();
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toEqual(["why aren't you asking questions"]);
  });

  it("only the latest parked line is kept, and the replacement is logged", async () => {
    const { controller, sent, s, logs } = harness();
    s.speaking = true;
    controller.onTranscript("what's the question");
    controller.onTranscript("say something please");
    expect(logs.at(-1)).toMatchObject({ replaced: "what's the question" });
    s.speaking = false;
    s.stoppedAt = Date.now();
    controller.notifyIdle();
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toEqual(["say something please"]);
  });

  it("stale, echo and lone-filler parked lines are discarded with a logged reason", async () => {
    for (const [text, wait, reason] of [
      ["I did drive it last week", 9000, "stale"],
      ["congratulations on your 2026 Mazda", 0, "echo"],
      ["yeah", 0, "lone_filler"],
    ] as const) {
      const { controller, sent, s, logs } = harness();
      s.speaking = true;
      controller.onTranscript(text);
      await vi.advanceTimersByTimeAsync(wait);
      s.speaking = false;
      s.stoppedAt = Date.now();
      controller.notifyIdle();
      await vi.advanceTimersByTimeAsync(700);
      expect(sent, text).toEqual([]);
      expect(logs.at(-1), text).toMatchObject({ event: "pending_discarded", reason, transcript: text });
    }
  });

  it("a stop word goes through even while Max is speaking", () => {
    const { controller, sent, s } = harness();
    s.speaking = true;
    controller.onTranscript("wait, hold on a second");
    expect(sent).toEqual(["wait, hold on a second"]);
  });

  it("isLoneFiller recognizes backchannels but not answers", () => {
    for (const t of ["yeah", "mm-hm", "uh huh", "okay okay", "I see", "got it"]) expect(isLoneFiller(t), t).toBe(true);
    for (const t of ["yes I drove it", "what was the question", "no"]) expect(isLoneFiller(t), t).toBe(false);
  });
});
