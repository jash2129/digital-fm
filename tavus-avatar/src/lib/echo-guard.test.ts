/**
 * Follow-up 10: speaker echo (live call d4711cfb, client on laptop speakers).
 */
import { describe, it, expect } from "vitest";
import { normalizeSpeech, isNearExactEcho } from "./echo-guard";
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
