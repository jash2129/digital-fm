/**
 * Free AI, Option D (MAX_MODE=free): the AI runs the call, code still guards prices, facts and the
 * recording disclosure, and a turn the AI cannot do safely goes to the scripted controller. Mocked AI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isFreeAIEnabled,
  parseFreeReply,
  parseFreeReplyOrText,
  callStateNote,
  guardFreeReply,
  lowestAllowedPrice,
  dailyPrices,
  runFreeTurn,
  buildFreeSystemPrompt,
  type FreeReply,
} from "./free-ai";
import { processControllerTurn, getOrCreateCallState, resetCallState, BEATS } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { CLOSING_LINE, DECLINE_LINE } from "./max-lines";

const ENV = { ...process.env };
let replies: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

/** The AI answers with these replies in order (JSON objects are stringified); the last one repeats */
function aiReplies(...r: Array<Record<string, unknown> | string>) {
  replies = r.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  let i = 0;
  fetchMock = vi.fn(async () => {
    const content = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  delete process.env.MAX_UNDERSTANDING;
  delete process.env.MAX_SPEECH;
  process.env.MAX_MODE = "free";
  process.env.XAI_API_KEY = "test-key";
  aiReplies({ say: "Glad to hear it!", beat: 0 });
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const say = (sid: string, text: string) => processControllerTurn(sid, text, DEFAULT_DEAL_CONFIG);
function newCall(beat = 0, opts: { disclosed?: boolean; lowest?: number } = {}) {
  const sid = `free_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  if (beat >= 1) {
    st.step0_completed = true;
    st.current_beat = beat;
    st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
    st.free_disclosure_given = opts.disclosed ?? true;
  }
  if (opts.lowest !== undefined) st.free_lowest_offer = opts.lowest;
  return sid;
}

const reply = (p: Partial<FreeReply>): FreeReply => ({ say: "Okay.", beat: 5, endCall: false, declined: false, ...p });
const corpus = BEATS.map((b) => b.text).join(" ");

describe("the switch", () => {
  it("is off unless MAX_MODE=free", () => {
    delete process.env.MAX_MODE;
    expect(isFreeAIEnabled()).toBe(false);
    process.env.MAX_MODE = "free";
    expect(isFreeAIEnabled()).toBe(true);
  });

  it("the prompt carries the whole script, the price ladder and the disclosure", () => {
    const p = buildFreeSystemPrompt({ beats: [{ id: 1, text: "Beat one text" }, { id: 22, text: "Price beat" }], facts: "- a fact", vehicle: "2026 Mazda CX five", disclosure: "DISCLOSURE SENTENCE" });
    expect(p).toContain("Beat 1: Beat one text");
    expect(p).toContain("Beat 22: Price beat");
    expect(p).toContain("DISCLOSURE SENTENCE");
    expect(p).toMatch(/Never below three dollars/);
    expect(p).toMatch(/no human team/i);
  });
});

describe("reading the AI's reply", () => {
  it("takes JSON, also wrapped in text", () => {
    expect(parseFreeReply('Sure: {"say":"Hi there","beat":3,"end_call":false}')).toEqual({ say: "Hi there", beat: 3, endCall: false, declined: false });
  });
  it("rejects missing say, missing beat, or not JSON", () => {
    for (const raw of ['{"beat":3}', '{"say":"hi"}', "just words", '{"say":"","beat":1}']) expect(parseFreeReply(raw), raw).toBeNull();
  });
  it("clamps the beat to the script", () => {
    expect(parseFreeReply('{"say":"x","beat":99}')?.beat).toBe(25);
  });
  it("plain sentences instead of JSON are Max's words, and the call stays where it is", () => {
    expect(parseFreeReplyOrText("Yeah, the powertrain is the engine and transmission.", 6)).toEqual({ say: "Yeah, the powertrain is the engine and transmission.", beat: 6, endCall: false, declined: false });
    expect(parseFreeReplyOrText('{"say": "broken', 6)).toBeNull();
    expect(parseFreeReplyOrText("   ", 6)).toBeNull();
  });
  it("every turn tells the AI where the call is", () => {
    const n = callStateNote({ beat: 6, disclosureGiven: true, lowestOffered: null });
    expect(n).toMatch(/furthest script beat delivered: 6 \(next: Beat 7\)/);
    expect(n).toMatch(/disclosure already given: yes, never repeat it/);
    expect(callStateNote({ beat: 23, disclosureGiven: true, lowestOffered: 3.5 })).toMatch(/\$3\.5 a day/);
  });
});

describe("the guards", () => {
  const ctx = (beatBefore: number, lowestOffered: number | null = null) => ({ corpus, beatBefore, lowestOffered });

  it("prices only from Beat 22, $4 first", () => {
    expect(guardFreeReply(reply({ say: "It's four dollars a day.", beat: 10 }), ctx(9)).reason).toMatch(/price before/);
    expect(guardFreeReply(reply({ say: "It's just four dollars a day.", beat: 22 }), ctx(21)).ok).toBe(true);
    expect(guardFreeReply(reply({ say: "Three dollars a day.", beat: 22 }), ctx(21)).reason).toMatch(/skipped down/);
  });

  it("one step down at a time, never under three dollars, never off the ladder", () => {
    expect(guardFreeReply(reply({ say: "I can do three dollars and fifty cents a day.", beat: 23 }), ctx(22, 4)).ok).toBe(true);
    expect(guardFreeReply(reply({ say: "I can do three dollars a day.", beat: 23 }), ctx(22, 4)).reason).toMatch(/skipped down/);
    expect(guardFreeReply(reply({ say: "How about two dollars a day?", beat: 23 }), ctx(23, 3)).reason).toMatch(/unapproved price/);
    expect(guardFreeReply(reply({ say: "Three dollars and seventy-five cents a day.", beat: 23 }), ctx(23, 4)).reason).toMatch(/unapproved/);
    expect(lowestAllowedPrice(3)).toBe(3);
    expect(lowestAllowedPrice(3.25)).toBe(3);
  });

  it("no invented numbers, risky claims, other makes, or claiming to be human", () => {
    expect(guardFreeReply(reply({ say: "It covers you for twelve years." }), ctx(5)).reason).toMatch(/new (number|figure)/);
    expect(guardFreeReply(reply({ say: "The powertrain is ten years, hundred thousand miles." }), ctx(6)).ok).toBe(true);
    expect(guardFreeReply(reply({ say: "You can cancel any time for a full refund." }), ctx(5)).reason).toMatch(/adds terms/);
    expect(guardFreeReply(reply({ say: "Don't worry, I'm a real person." }), ctx(5)).reason).toMatch(/human/);
    expect(guardFreeReply(reply({ say: "Just like on a Toyota." }), ctx(5)).reason).toMatch(/toyota/);
    expect(guardFreeReply(reply({ say: "**Great**" }), ctx(5)).reason).toBe("formatting");
  });

  it("a refusal at the price is never confirmed, and above the floor gets the next lower price", () => {
    const refused = (lowest: number) => ({ corpus, beatBefore: 23, lowestOffered: lowest, refusedPrice: true });
    const confirm = "Okay, so to confirm, we're moving forward with full vehicle protection for three dollars and fifty cents a day.";
    expect(guardFreeReply(reply({ say: confirm, beat: 24 }), refused(4)).reason).toMatch(/confirmed the package right after a refusal/);
    expect(guardFreeReply(reply({ say: "Which two of those do you see the most value in?", beat: 23 }), refused(4)).reason).toMatch(/must get the next lower price, \$3\.5/);
    expect(guardFreeReply(reply({ say: "I hear you. I can do three dollars and fifty cents a day.", beat: 23 }), refused(4)).ok).toBe(true);
    // At the floor: no lower price exists, but still never a confirmation
    expect(guardFreeReply(reply({ say: "Three dollars a day is the lowest I can go. Go ahead, or keep your factory warranty?", beat: 23 }), refused(3)).ok).toBe(true);
    expect(guardFreeReply(reply({ say: "Great, so to confirm, we're moving forward with it.", beat: 24 }), refused(3)).ok).toBe(false);
  });

  it("reads prices said in words and digits", () => {
    expect(dailyPrices("four dollars a day, or $3.25 per day, three dollars and fifty cents a day")).toEqual([4, 3.5, 3.25]);
  });
});

describe("asking the AI", () => {
  const args = { system: "s", history: [], customer: "hi", guard: { corpus, beatBefore: 21, lowestOffered: null } };

  it("retries once with the reason, then uses the good reply", async () => {
    aiReplies({ say: "Two dollars a day!", beat: 22 }, { say: "It's four dollars a day.", beat: 22 });
    const r = await runFreeTurn(args);
    expect(r.ok && r.attempts).toBe(2);
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(second.messages.at(-1).content).toMatch(/not used \(rejected: unapproved price/);
  });

  it("gives up after two rejections, an HTTP error or a timeout", async () => {
    aiReplies({ say: "Two dollars a day!", beat: 22 });
    expect((await runFreeTurn(args)).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await runFreeTurn(args)).toMatchObject({ ok: false, reason: "http 500" });
  });
});

describe("in a call", () => {
  it("Max says the AI's words and the call moves where the AI says", async () => {
    aiReplies({ say: "Awesome, glad you got to drive it! When you came back, did the salesperson show you around the car?", beat: 3 });
    const sid = newCall(2);
    const d = await say(sid, "Yeah I took it out on the highway, loved it");
    expect(d.metrics?.mode).toBe("free");
    expect(d.textToSpeak).toMatch(/^Awesome/);
    expect(d.beatId).toBe(3);
    expect(getOrCreateCallState(sid).free_history?.at(-1)?.content).toBe(d.textToSpeak);
  });

  it("the call never moves back", async () => {
    aiReplies({ say: "Sure, happy to go over that again.", beat: 4 });
    const d = await say(newCall(9), "wait, what was the first part?");
    expect(d.beatId).toBe(9);
  });

  it("moving past the disclosure without it: the disclosure is added word for word and the call waits at Beat 1", async () => {
    aiReplies({ say: "Great! So, let's talk about your coverage.", beat: 4 });
    const sid = newCall(0);
    const d = await say(sid, "Yes I can hear you, it's been great");
    expect(d.textToSpeak).toMatch(/both audio and video/);
    expect(d.beatId).toBe(1);
    expect(getOrCreateCallState(sid).free_disclosure_given).toBe(true);
  });

  it("a price updates the ladder and shows the payment panel", async () => {
    aiReplies({ say: "I hear you. I can bring it down to three dollars and fifty cents a day. How does that sound?", beat: 23 });
    const sid = newCall(22, { lowest: 4 });
    const d = await say(sid, "That's too much");
    const st = getOrCreateCallState(sid);
    expect(st.free_lowest_offer).toBe(3.5);
    expect(st.concession_stage).toBe(2);
    expect(d.toolCalls).toContainEqual({ name: "show_payment_breakdown", args: { daily_rate: 3.5 } });
  });

  it("a turn the AI cannot do safely is taken by the script, and the AI carries on after", async () => {
    aiReplies({ say: "Fine, two dollars a day.", beat: 23 });
    const sid = newCall(23, { lowest: 3.25 });
    getOrCreateCallState(sid).concession_stage = 3;
    const d = await say(sid, "No, still too much.");
    expect(d.metrics?.mode).toBe("script");
    expect(d.metrics?.freeReason).toMatch(/unapproved price/);
    expect(d.textToSpeak).toContain("three dollars");
    expect(d.textToSpeak).not.toMatch(/two dollars/);
    const st = getOrCreateCallState(sid);
    expect(st.free_lowest_offer).toBe(3);
    expect(st.free_history?.at(-1)?.content).toBe(d.textToSpeak);
  });

  it("'No' at the price, three times: never a confirmed sale (simulated batch 2026-11-21)", async () => {
    // The AI keeps trying to confirm; the guard rejects it, and the script takes those turns
    aiReplies({ say: "Okay, so to confirm, we're moving forward with full vehicle protection for three dollars and fifty cents a day.", beat: 24 });
    const sid = newCall(23, { lowest: 4 });
    const steps = ["three dollars and fifty cents", "three dollars and twenty-five cents", "three dollars a day"];
    for (const [i, line] of ["No", "No. What's the actual lowest you can do?", "No. Too expensive."].entries()) {
      const d = await say(sid, line);
      expect(d.textToSpeak, line).not.toMatch(/moving forward with/i);
      expect(d.metrics?.mode, line).toBe("script");
      expect(d.textToSpeak, line).toContain(steps[i]);
    }
    expect(getOrCreateCallState(sid).free_lowest_offer).toBe(3);
  });

  it("the customer's own numbers (their address) are not invented figures", () => {
    const ctx = { corpus, beatBefore: 25, lowestOffered: 3, customerSaid: "My address is 1423 Oak Grove Lane, Austin 78704" };
    expect(guardFreeReply(reply({ say: "Thanks, I have 1423 Oak Grove Lane, Austin 78704.", beat: 25 }), ctx).ok).toBe(true);
    expect(guardFreeReply(reply({ say: "Thanks, I have 1423 Oak Grove Lane, Austin 78704.", beat: 25 }), { ...ctx, customerSaid: "" }).ok).toBe(false);
  });

  it("saying Max's last line again word for word is rejected", () => {
    const last = "Thank you David, I've noted that down. Now let me quickly verify your full legal name.";
    expect(guardFreeReply(reply({ say: last, beat: 25 }), { corpus, beatBefore: 25, lowestOffered: 3, recentMax: [last] }).reason).toBe("repeats what Max just said");
  });

  it("a refusal after the final choice at three dollars: the script keeps the factory warranty", async () => {
    aiReplies({ say: "At three dollars a day, would you like to go ahead, or keep just your factory warranty?", beat: 23 });
    const sid = newCall(23, { lowest: 3 });
    getOrCreateCallState(sid).concession_stage = 4;
    const first = await say(sid, "I'm not buying any of it.");
    expect(first.metrics?.mode).toBe("free");
    expect(getOrCreateCallState(sid).floor_decision_asked).toBe(true);
    const second = await say(sid, "Just the factory warranty. No protection package at all.");
    expect(second.metrics?.mode).toBe("script");
    expect(second.textToSpeak.startsWith(DECLINE_LINE)).toBe(true);
    expect(getOrCreateCallState(sid).package_declined).toBe(true);
  });

  it("a lone fragment is handled by the script and never moves the call on", async () => {
    aiReplies({ say: "Great, moving on to the next part.", beat: 14 });
    const sid = newCall(12);
    const d = await say(sid, "Oh");
    expect(d.metrics?.mode).toBe("script");
    expect(d.metrics?.freeReason).toMatch(/fragment/);
    expect(d.beatId).toBe(12);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ending the call closes it; every later turn gets the fixed closing line", async () => {
    aiReplies({ say: "Thanks so much, take care!", beat: 25, end_call: true });
    const sid = newCall(25);
    const d = await say(sid, "Okay bye");
    expect(d.isScriptComplete).toBe(true);
    expect(d.beatType).toBe("stop");
    const after = await say(sid, "hello?");
    expect(after.textToSpeak).toBe(CLOSING_LINE);
  });

  it("with no AI key, every turn is the script", async () => {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const d = await say(newCall(7), "okay");
    expect(d.metrics?.mode).toBe("script");
    expect(d.metrics?.freeReason).toBe("no AI key");
  });
});
