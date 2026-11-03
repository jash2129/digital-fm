/**
 * Follow-up 10: speaker echo (live call d4711cfb, client on laptop speakers).
 */
import { describe, it, expect } from "vitest";
import { normalizeSpeech, isNearExactEcho, isMaxWordRun, checkEcho, EchoTimeline, ECHO_TAIL_MS, UtteranceClock, UTTERANCE_GAP_MS } from "./echo-guard";
import { isAvatarScriptEcho } from "./beat-controller";

describe("E1: both sides are normalized before comparing", () => {
  it("normalizes spelling variants, punctuation, numbers and repeats", () => {
    expect(normalizeSpeech("Can you hear and see me alright?")).toBe("can you hear and see me alright");
    expect(normalizeSpeech("can you hear and see me all right")).toBe("can you hear and see me alright");
    expect(normalizeSpeech("OK, sure")).toBe("okay sure");
    expect(normalizeSpeech("mm hm")).toBe("mhm");
    expect(normalizeSpeech("Mm-hmm.")).toBe("mhm");
    expect(normalizeSpeech("5 years, 10 years, 25")).toBe("five years ten years twenty five");
    expect(normalizeSpeech("the the car car")).toBe("the car");
  });

  it("'can you hear and see me all right' vs Max's 'Can you hear and see me alright?' is echo", () => {
    expect(isNearExactEcho("can you hear and see me all right", ["Can you hear and see me alright?"])).toBe(true);
  });

  it("a different sentence from the customer is not echo", () => {
    expect(isNearExactEcho("yes I can hear you fine thanks", ["Can you hear and see me alright?"])).toBe(false);
  });

  it("the server-side script echo check sees the same normalized text", () => {
    expect(isAvatarScriptEcho("make sure you understand first ok")).toBe(true);
  });
});

// Max spoke from t=1000 to t=5000
function timeline() {
  const t = new EchoTimeline();
  t.maxStarted(1000);
  t.maxStopped(5000);
  return t;
}

describe("E2: fragments of Max's recent speech are echo", () => {
  const STILL_WITH_ME = "Are you still with me? Is that okay with you?";
  const CLARIFY = "Would you like me to continue, or go over that again?";
  const check = (said: string, lines: string[], at = 4000) => checkEcho(said, { recentMaxLines: lines, speechStartAt: at, timeline: timeline() });

  it("'are you' after Max said '...are you still with me' is dropped as echo_fragment", () => {
    expect(check("are you", [STILL_WITH_ME])).toEqual({ echo: true, reason: "echo_fragment" });
  });

  it("'would you like me' after 'Would you like me to continue' is dropped", () => {
    expect(check("would you like me", [CLARIFY])).toEqual({ echo: true, reason: "echo_fragment" });
  });

  it("'yes please continue' is kept: 'yes please' is not a run of Max's words", () => {
    expect(check("yes please continue", [CLARIFY])).toEqual({ echo: false });
  });

  it("a 1-word reply is never a fragment, even if Max said it", () => {
    expect(check("okay", [STILL_WITH_ME])).toEqual({ echo: false });
    expect(check("continue", [CLARIFY])).toEqual({ echo: false });
  });

  it("a transcript with a word Max did not say is kept", () => {
    // Short enough that only the fragment rule could catch it ("stop" / "that" are not his words)
    expect(check("would you stop", [CLARIFY])).toEqual({ echo: false });
    expect(check("you like that", [CLARIFY])).toEqual({ echo: false });
  });

  it("only within 3 s after Max stopped", () => {
    expect(check("would you like me", [CLARIFY], 5000 + ECHO_TAIL_MS - 1).echo).toBe(true);
    expect(check("would you like me", [CLARIFY], 5000 + ECHO_TAIL_MS + 1).echo).toBe(false);
    expect(check("would you like me", [CLARIFY], 500).echo).toBe(false);
  });

  it("only Max's last 2 lines count", () => {
    expect(check("would you like me", [CLARIFY, "Great.", "Thanks."]).echo).toBe(false);
    expect(check("would you like me", ["Great.", CLARIFY]).echo).toBe(true);
  });

  it("the run has to be contiguous", () => {
    expect(isMaxWordRun("would like", [CLARIFY])).toBe(false);
    expect(isMaxWordRun("like me to", [CLARIFY])).toBe(true);
  });
});

describe("E3: speech is timed by when it started, not when the text arrived", () => {
  const CLARIFY = "Would you like me to continue, or go over that again?";

  it("a final that arrives 5 s late but began while Max was talking is still echo", () => {
    const clock = new UtteranceClock();
    clock.speechStarted(4500); // Max is speaking (1000-5000)
    const startAt = clock.result(9500); // the final lands 5 s later, after the 3 s tail
    expect(startAt).toBe(4500);
    expect(checkEcho("would you like me", { recentMaxLines: [CLARIFY], speechStartAt: startAt, timeline: timeline() }).echo).toBe(true);
    // Judged by arrival time it would have slipped through
    expect(checkEcho("would you like me", { recentMaxLines: [CLARIFY], speechStartAt: 9500, timeline: timeline() }).echo).toBe(false);
  });

  it("without a speech-start event, the first result starts the utterance and later results keep it", () => {
    const clock = new UtteranceClock();
    expect(clock.result(1000)).toBe(1000);
    expect(clock.result(1800)).toBe(1000);
    expect(clock.result(3500)).toBe(1000);
  });

  it("a result after a gap, or after reset, starts a new utterance", () => {
    const clock = new UtteranceClock();
    clock.result(1000);
    expect(clock.result(1000 + UTTERANCE_GAP_MS + 1)).toBe(1000 + UTTERANCE_GAP_MS + 1);
    clock.reset();
    expect(clock.result(9000)).toBe(9000);
  });
});
