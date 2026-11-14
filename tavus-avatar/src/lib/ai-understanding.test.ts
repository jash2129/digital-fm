/**
 * AI-first understanding (MAX_UNDERSTANDING=ai): the AI picks what the customer meant from a fixed
 * menu, the rules stay in charge of consent, the price and ending the call, and anything doubtful
 * falls back to the rules. The AI is mocked: no live calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shouldAskAI, parseUnderstanding, understandWithAI, MEANINGS, type UnderstandingContext } from "./ai-understanding";
import { processControllerTurn, getOrCreateCallState, resetCallState, BEATS } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { STEP_0_NEUTRAL_ACK_LINE } from "./max-lines";

const ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

/** The AI replies with this meaning (or raw text) */
function aiReplies(reply: Record<string, unknown> | string) {
  const content = typeof reply === "string" ? reply : JSON.stringify(reply);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  process.env.MAX_UNDERSTANDING = "ai";
  process.env.XAI_API_KEY = "test-key";
  aiReplies({ meaning: "unclear", confidence: 0.9, reason: "default" });
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const say = (sid: string, text: string) => processControllerTurn(sid, text, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number, stage?: number) {
  const sid = `ai_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  if (stage) st.concession_stage = stage;
  return sid;
}

describe("when the AI is asked", () => {
  it("only with the switch on", () => {
    delete process.env.MAX_UNDERSTANDING;
    expect(shouldAskAI("my brother had a transmission go out last year", 9, "other")).toBe(false);
    process.env.MAX_UNDERSTANDING = "ai";
    expect(shouldAskAI("my brother had a transmission go out last year", 9, "other")).toBe(true);
  });

  it("never at the recording consent, the price or the close, nor for short replies", () => {
    for (const beat of [1, 22, 23, 24, 25]) expect(shouldAskAI("well I am not really sure about that one", beat, "other"), `beat ${beat}`).toBe(false);
    expect(shouldAskAI("yes please", 9, "agree")).toBe(false);
  });

  it("never second-guesses a hang-up, a request for a human, or the price", () => {
    for (const intent of ["hang_up", "human_request", "negotiate_price", "price_ask", "language_request"] as const) {
      expect(shouldAskAI("okay I think I really need to go now", 9, intent), intent).toBe(false);
    }
  });
});

describe("the validator", () => {
  const ctx = { beatId: 9, beatExpects: "statement" as const };

  it("accepts a meaning on the menu", () => {
    const r = parseUnderstanding('{"meaning":"trust_concern","confidence":0.9,"reason":"worried about fees"}', ctx);
    expect(r?.intent).toBe("customer_anxious");
    expect(r?.source).toBe("ai");
  });

  it("rejects anything off the menu, unsure, broken, or ending the call", () => {
    expect(parseUnderstanding('{"meaning":"sell_harder","confidence":0.99}', ctx)).toBeNull();
    expect(parseUnderstanding('{"meaning":"agree","confidence":0.3}', ctx)).toBeNull();
    expect(parseUnderstanding("I think they agree", ctx)).toBeNull();
    expect(parseUnderstanding('{"meaning":"ending_call","confidence":0.99}', ctx)).toBeNull();
  });

  it("a story carries on while Max explains, and is acknowledged at a question", () => {
    const story = '{"meaning":"story_or_comment","confidence":0.9}';
    expect(parseUnderstanding(story, ctx)?.intent).toBe("agree");
    expect(parseUnderstanding(story, { beatId: 2, beatExpects: "yes_no" })?.intent).toBe("acknowledge");
  });

  it("keeps only real coverage beats as topics", () => {
    const r = parseUnderstanding('{"meaning":"coverage_question","topic_beat_ids":[17,22,99],"confidence":0.8}', ctx);
    expect(r?.topic_beat_ids).toEqual([17]);
  });

  it("every meaning has a description the AI sees", () => {
    for (const [k, v] of Object.entries(MEANINGS)) expect(v.length, k).toBeGreaterThan(10);
  });
});

describe("falling back to the rules", () => {
  const ctx: UnderstandingContext = {
    transcript: "my brother had a transmission go out last year",
    beatId: 9,
    beatExpects: "statement",
    beatText: "",
    lastSpoken: "",
    pendingQuestion: "",
    recentTurns: [],
    ruleResult: { intent: "other", topic_beat_ids: [] },
  };

  it("on an error from the AI", async () => {
    const r = await understandWithAI(ctx, (async () => new Response("down", { status: 503 })) as typeof fetch);
    expect(r.intent).toBe("other");
    expect(r.source).toBe("rules");
    expect(r.aiReason).toBe("http 503");
  });

  it("when the AI is too slow", async () => {
    process.env.AI_UNDERSTANDING_TIMEOUT_MS = "50";
    const { understandWithAI: fresh } = await import("./ai-understanding");
    const slow = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const r = await Promise.race([fresh(ctx, slow), new Promise<null>((res) => setTimeout(() => res(null), 3000))]);
    expect(r?.source).toBe("rules");
  });
});

describe("in a call", () => {
  it("rambler: a story with 'no' in it carries the explanation on", async () => {
    aiReplies({ meaning: "story_or_comment", confidence: 0.9, reason: "family repair story" });
    const t = await say(atBeat(9), "No kidding, my brother-in-law had a transmission go out on his truck last year");
    expect(t.beatId).toBe(10);
    expect(t.metrics?.understanding).toBe("ai");
  });

  it("distrustful: 'yeah, but how do I know…' is reassured, not taken as a yes", async () => {
    aiReplies({ meaning: "trust_concern", confidence: 0.9, reason: "fears hidden charges" });
    const t = await say(atBeat(7), "Yeah but how do I know you won't add more charges once I sign");
    expect(t.beatId).toBe(7);
    expect(t.intent).toBe("customer_anxious");
  });

  it("confused: re-explains instead of 'didn't catch that'", async () => {
    aiReplies({ meaning: "confused", confidence: 0.85, reason: "doesn't see relevance" });
    const t = await say(atBeat(8), "I don't really get what the bumper thing has to do with me");
    expect(t.beatId).toBe(8);
    expect(t.intent).toBe("confusion");
  });

  it("a long yes at the test-drive question counts as a yes", async () => {
    aiReplies({ meaning: "agree", confidence: 0.9, reason: "took it on the highway" });
    const t = await say(atBeat(2), "oh we took it out on the highway for a good while, loved it");
    expect(t.beatId).toBeGreaterThan(2);
  });

  it("a story at the test-drive question is acknowledged and the question asked again", async () => {
    aiReplies({ meaning: "story_or_comment", confidence: 0.9, reason: "talks about the weather" });
    const t = await say(atBeat(2), "it was pouring rain when we got to the dealership this morning");
    expect(t.beatId).toBe(2);
    expect(t.textToSpeak.startsWith(STEP_0_NEUTRAL_ACK_LINE)).toBe(true);
  });

  it("the AI cannot end the call", async () => {
    aiReplies({ meaning: "ending_call", confidence: 0.99, reason: "wants to go" });
    const t = await say(atBeat(9), "I have to pick up my kids from school later today");
    expect(t.state.is_stopped).toBe(false);
    expect(t.metrics?.understanding).toBe("rules");
  });

  it("the recording consent and the price never ask the AI", async () => {
    const a = await say(atBeat(1), "I am not sure I want this recorded at all");
    const b = await say(atBeat(23, 2), "I don't know, that still seems like quite a lot to me");
    // (the old classifier may still be asked when no rule matches, as before: never the AI-first step)
    const aiFirstCalls = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit).body).includes("MEANS"));
    expect(aiFirstCalls).toHaveLength(0);
    expect(a.metrics?.understanding).toBeUndefined();
    expect(b.metrics?.understanding).toBeUndefined();
  });

  it("the AI sees where Max is and the last turns", async () => {
    aiReplies({ meaning: "story_or_comment", confidence: 0.9, reason: "story" });
    const sid = atBeat(9);
    await say(sid, "my old car had the worst potholes on my commute every morning");
    await say(sid, "and my cousin had to replace a whole transmission in July");
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    const user = JSON.parse(body.messages[1].content);
    expect(user.beat).toBe(10);
    expect(user.recent_turns).toHaveLength(1);
    expect(user.customer_now).toContain("cousin");
  });
});
