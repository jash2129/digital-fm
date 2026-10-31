/**
 * Turn-taking unit tests (follow-up 6, from live session 1ee5181b). Fake timers drive the
 * controller exactly as the browser would: speech recognizer -> controller -> request -> speech.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TurnController,
  AvatarVoice,
  SPEAK_START_TIMEOUT_MS,
  isLoneFiller,
  type AvatarCommand,
  type TurnLogEvent,
} from "./turn-taking";

/** A LiveKit publish stand-in that records commands; optionally slow or failing per command type. */
function recorder(opts: { delayMs?: number; failOn?: AvatarCommand["type"] } = {}) {
  const published: string[] = [];
  const publish = async (cmd: AvatarCommand) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.failOn === cmd.type) throw new Error(`publishData failed for ${cmd.type}`);
    published.push(cmd.type === "speak_text" ? `speak_text:${cmd.text}` : cmd.type);
  };
  return { published, publish };
}

function voice(opts: { delayMs?: number; failOn?: AvatarCommand["type"] } = {}) {
  const rec = recorder(opts);
  const changes: Array<[boolean, string]> = [];
  const logs: TurnLogEvent[] = [];
  const v = new AvatarVoice(rec.publish, (s, r) => changes.push([s, r]), (e) => logs.push(e));
  return { v, rec, changes, logs };
}

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

describe("Q2: the speaking flag is truthful", () => {
  it("(a) interruptAvatar with a throwing publishData leaves isAvatarSpeaking false", async () => {
    const { v, changes, logs } = voice({ failOn: "interrupt" });
    void v.speak("First I see that you agreed to buy a new car.");
    await vi.advanceTimersByTimeAsync(0);
    v.tracker.onStarted();
    expect(v.tracker.speaking).toBe(true);

    await v.interrupt();
    expect(v.tracker.speaking).toBe(false);
    expect(changes.at(-1)).toEqual([false, "interrupted"]);
    expect(logs.some((e) => e.event === "interrupt_failed")).toBe(true);
  });

  it("no start event within 3 s resets the flag and logs it", async () => {
    const { v, logs } = voice();
    void v.speak("Can you hear and see me alright?");
    await vi.advanceTimersByTimeAsync(0);
    expect(v.tracker.speaking).toBe(true);
    await vi.advanceTimersByTimeAsync(SPEAK_START_TIMEOUT_MS + 10);
    expect(v.tracker.speaking).toBe(false);
    expect(logs.at(-1)).toMatchObject({ event: "speaking_flag_reset", reason: "speak_start_timeout" });
  });

  it("the watchdog runs from real first audio, so a long line is not cut short at 10 s", async () => {
    const { v } = voice();
    const longLine = Array.from({ length: 70 }, () => "word").join(" "); // ~25 s of speech
    void v.speak(longLine);
    await vi.advanceTimersByTimeAsync(1500);
    v.tracker.onStarted();
    await vi.advanceTimersByTimeAsync(12000);
    expect(v.tracker.speaking).toBe(true);
    v.tracker.onStopped();
    expect(v.tracker.speaking).toBe(false);
  });

  it("(e) speak_text is never published after a newer interrupt", async () => {
    const { v, rec } = voice({ delayMs: 50 });
    void v.speak("A"); // starts publishing
    void v.speak("B"); // queued behind A, issued before the barge-in
    const interrupted = v.interrupt(); // barge-in
    void v.speak("C"); // issued after the barge-in
    await vi.advanceTimersByTimeAsync(1000); // let the slow publishes run
    await interrupted;

    const firstInterrupt = rec.published.indexOf("interrupt");
    expect(firstInterrupt).toBeGreaterThan(-1);
    // Nothing issued before the interrupt is published after it
    const afterInterrupt = rec.published.slice(firstInterrupt + 1);
    expect(afterInterrupt).not.toContain("speak_text:A");
    expect(afterInterrupt).not.toContain("speak_text:B");
    expect(rec.published).not.toContain("speak_text:B");
    expect(afterInterrupt).toContain("speak_text:C");
  });
});
