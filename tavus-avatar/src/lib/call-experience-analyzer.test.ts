/** Inspector accuracy (follow-up 6 V): echo labelling and cut counting. */
import { describe, it, expect } from "vitest";
import { analyzeCallExperience } from "./call-experience-analyzer";
import type { HeygenCallLog, TurnTimingLog, BargeInLog } from "./heygen-logger";

const T0 = Date.parse("2026-10-31T08:00:00.000Z");

function turn(turnId: number, userInput: string, avatarText: string, speechEndSec: number, audioStartSec: number): TurnTimingLog {
  const ue = T0 + speechEndSec * 1000;
  const as = T0 + audioStartSec * 1000;
  return {
    turnId,
    userInput,
    avatarText,
    timestamps: { user_speech_end: ue, final_transcript: ue, controller_decision: ue + 10, speak_sent: ue + 20, avatar_audio_start: as },
    gaps: { transcription_gap_ms: 0, controller_gap_ms: 10, speak_sent_gap_ms: 10, avatar_render_gap_ms: as - ue - 20, total_latency_ms: as - ue },
  };
}

function log(timingLogs: TurnTimingLog[], bargeIns: BargeInLog[] = []): HeygenCallLog {
  return {
    sessionId: "test",
    engine: "heygen-grok",
    avatarId: "x",
    avatarName: "Max",
    startTime: new Date(T0).toISOString(),
    endTime: new Date(T0 + 120000).toISOString(),
    durationSeconds: 120,
    status: "completed",
    transcript: [],
    timingLogs,
    bargeIns,
  };
}

const DISCLOSURE =
  "Now before I start, I just want to let you know this transaction is recorded audio and video, also I'm required by the law to go over everything with you before you sign any paperwork to make sure you understand first okay.";

describe("V: Inspector accuracy", () => {
  it("'okay' arriving at the end of a line that ends in 'okay' is the customer answering, not echo", () => {
    // Max's disclosure starts at 2s (~41 words, ~16s); the customer's "OK" lands at its end
    const a = analyzeCallExperience(log([turn(1, "it was fine", DISCLOSURE, 1, 2), turn(2, "OK", "First I see that you agreed to buy a new car.", 18, 19.5)]));
    expect(a.echoCount).toBe(0);
    expect(a.experienceFlaws.some((f) => f.category === "echo_loop")).toBe(false);
  });

  it("a real echo of Max's words is still flagged", () => {
    const a = analyzeCallExperience(
      log([turn(1, "it was fine", DISCLOSURE, 1, 2), turn(2, "transaction is recorded audio and video", "First I see that you agreed to buy a new car.", 8, 9)])
    );
    expect(a.echoCount).toBe(1);
  });

  it("every cut is counted and listed with what triggered it, matching the picker's count", () => {
    const lines = [turn(1, "yes", "First I see that you agreed to buy a new car. Have you got the chance to drive it?", 1, 2), turn(2, "yes", "When you came back from the test drive the salesperson did the walkaround.", 10, 11), turn(3, "yes", "What's your understanding of the warranty that comes with the vehicle?", 20, 21)];
    // Six cuts, two inside each of three lines
    const cuts: BargeInLog[] = [2.3, 2.9, 11.4, 12.0, 21.3, 21.8].map((sec, i) => ({
      timestamp: T0 + sec * 1000,
      spokenText: i % 2 ? "wait hold on" : "yeah",
      avatarTextWhenInterrupted: "line",
      honored: true,
      ...(i === 1 ? { msIntoLine: 900, words: 3, reason: "stop_word_in_grace" } : {}),
    }));
    const a = analyzeCallExperience(log(lines, cuts));
    const listed = a.experienceFlaws.filter((f) => f.category === "barge_in");
    expect(a.bargeInsCount).toBe(6);
    expect(listed).toHaveLength(6);
    expect(listed[1].title).toContain('"wait hold on" 0.9s into Max\'s line');
    expect(listed[1].description).toContain("3 words, rule: stop_word_in_grace");
    expect(listed[0].description).toContain('Triggered by "yeah" (1 word)');
  });
});
