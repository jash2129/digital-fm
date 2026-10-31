/**
 * Turn-taking unit tests (follow-up 6, from live session 1ee5181b). Fake timers drive the
 * controller exactly as the browser would: speech recognizer -> controller -> request -> speech.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TurnController,
  AvatarVoice,
  SPEAK_START_TIMEOUT_MS,
  DEAD_MAN_MS,
  SILENCE_PROMPT_MS,
  isLoneFiller,
  isPresenceCheck,
  type RepromptKind,
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
    controller.onTranscript("is the warranty transferable");
    expect(sent).toEqual(["I drove it yesterday"]);
    expect(logs.at(-1)).toMatchObject({ event: "transcript_parked", reason: "request_in_flight" });

    await vi.advanceTimersByTimeAsync(2000); // first request finishes
    await vi.advanceTimersByTimeAsync(1000); // past the post-speech guard
    expect(sent).toEqual(["I drove it yesterday", "is the warranty transferable"]);
    expect(logs.some((e) => e.event === "pending_replayed")).toBe(true);
  });

  it("a line said while Max is speaking is replayed once he stops", async () => {
    const { controller, sent, s } = harness();
    s.speaking = true;
    controller.onTranscript("I have a question about the tires");
    expect(sent).toEqual([]);
    s.speaking = false;
    s.stoppedAt = Date.now();
    controller.notifyIdle();
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toEqual(["I have a question about the tires"]);
  });

  it("only the latest parked line is kept, and the replacement is logged", async () => {
    const { controller, sent, s, logs } = harness();
    s.speaking = true;
    controller.onTranscript("I have a question");
    controller.onTranscript("is the warranty transferable");
    expect(logs.at(-1)).toMatchObject({ replaced: "I have a question" });
    s.speaking = false;
    s.stoppedAt = Date.now();
    controller.notifyIdle();
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toEqual(["is the warranty transferable"]);
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

describe("R2 (client): a superseded response is recognized as stale", () => {
  it("only the most recently dispatched turn is current", async () => {
    const ids: number[] = [];
    const c = new TurnController({
      runTurn: (_t, meta) => {
        ids.push(meta.turnId);
        return Promise.resolve();
      },
      isAvatarSpeaking: () => false,
      avatarStoppedAt: () => 0,
      isEcho: () => false,
      log: () => {},
    });
    c.onTranscript("yes I drove it");
    await vi.advanceTimersByTimeAsync(0);
    c.onTranscript("he did the walkaround");
    await vi.advanceTimersByTimeAsync(0);
    expect(ids).toEqual([1, 2]);
    expect(c.isLatestTurn(1)).toBe(false);
    expect(c.isLatestTurn(2)).toBe(true);
  });
});

/** A controller wired the way the component wires it, with every hook recorded. */
function wired(opts: { requestMs?: number; stuckSpeaking?: boolean } = {}) {
  const calls: string[] = [];
  const reprompts: RepromptKind[] = [];
  const logs: TurnLogEvent[] = [];
  const s = { speaking: Boolean(opts.stuckSpeaking), stoppedAt: 0 };
  const c = new TurnController({
    runTurn: (t, meta) => {
      calls.push(`turn:${t}${meta.bypass ? ":bypass" : ""}`);
      return new Promise((r) => setTimeout(r, opts.requestMs ?? 300));
    },
    isAvatarSpeaking: () => s.speaking,
    avatarStoppedAt: () => s.stoppedAt,
    isEcho: () => false,
    log: (e) => logs.push(e),
    interrupt: async () => {
      calls.push("interrupt");
    },
    reprompt: async (k) => {
      reprompts.push(k);
    },
  });
  return { c, calls, reprompts, logs, s };
}

describe("W: dead-man switch, silence watchdog, presence checks", () => {
  it("(d) 'say something' while the speaking flag is stuck TRUE still gets a reply within 1 s", async () => {
    const { c, calls } = wired({ stuckSpeaking: true });
    c.onTranscript("say something");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toContain("interrupt");
    expect(calls).toContain("turn:say something:bypass");
  });

  it("presence checks are recognized; real answers are not", () => {
    for (const t of ["Are you there?", "Hello.", "say something", "what was the question", "What's the question?", "why aren't you asking questions", "can you hear me"])
      expect(isPresenceCheck(t), t).toBe(true);
    for (const t of ["yeah", "I drove it", "hello I have a question about the warranty"]) expect(isPresenceCheck(t), t).toBe(false);
  });

  it("no audio 4 s after the customer spoke forces Max to speak", async () => {
    const { c, reprompts, logs } = wired({ requestMs: 500 });
    c.onTranscript("yeah I drove it yesterday");
    await vi.advanceTimersByTimeAsync(DEAD_MAN_MS - 100);
    expect(reprompts).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(reprompts).toEqual(["resume"]);
    expect(logs.some((e) => e.event === "dead_man_switch")).toBe(true);
  });

  it("the dead-man switch stays quiet once audio starts, and waits for a slow request", async () => {
    const quiet = wired({ requestMs: 500 });
    quiet.c.onTranscript("yeah I drove it yesterday");
    await vi.advanceTimersByTimeAsync(1500);
    quiet.c.onAvatarAudio();
    await vi.advanceTimersByTimeAsync(5000);
    expect(quiet.reprompts).toEqual([]);

    const slow = wired({ requestMs: 6000 });
    slow.c.onTranscript("yeah I drove it yesterday");
    await vi.advanceTimersByTimeAsync(5000);
    expect(slow.reprompts).toEqual([]); // request still in flight
    await vi.advanceTimersByTimeAsync(1600);
    expect(slow.reprompts).toEqual(["resume"]);
  });

  it("7 s of silence at a wait beat prompts: still-with-me, then clarify, at most 3 in a row", async () => {
    const { c, reprompts } = wired();
    for (let i = 0; i < 4; i++) {
      c.onAvatarFinished("wait");
      await vi.advanceTimersByTimeAsync(SILENCE_PROMPT_MS + 10);
    }
    expect(reprompts).toEqual(["still_with_me", "clarify", "clarify"]);
  });

  it("customer speech cancels the silence prompt and resets the count; continue beats never prompt", async () => {
    const { c, reprompts } = wired();
    c.onAvatarFinished("wait");
    await vi.advanceTimersByTimeAsync(5000);
    c.onCustomerActivity();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reprompts).toEqual([]);
    c.onAvatarFinished("continue");
    await vi.advanceTimersByTimeAsync(SILENCE_PROMPT_MS + 10);
    expect(reprompts).toEqual([]);
  });
});
