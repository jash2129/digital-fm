import { describe, it, expect } from "vitest";
import { scoreCall, statedDailyAmounts, type ScoredTurn } from "./call-scorecard";

const failed = (turns: ScoredTurn[]) => scoreCall(turns).checks.filter((c) => !c.pass).map((c) => c.id);

describe("call scorecard", () => {
  it("reads the daily prices Max states", () => {
    expect(statedDailyAmounts("only four dollars a day a coffee a day")).toEqual([4]);
    expect(statedDailyAmounts("the best I can offer directly is three dollars and fifty cents a day.")).toEqual([3.5]);
    expect(statedDailyAmounts("bring that down to three dollars and twenty-five cents a day")).toEqual([3.25]);
    expect(statedDailyAmounts("Three dollars a day is our absolute hard floor")).toEqual([3]);
    expect(statedDailyAmounts("I can do two dollars a day")).toEqual([2]);
    expect(statedDailyAmounts("engine by itself can cost up to seven thousand")).toEqual([]);
  });

  it("a clean call passes everything", () => {
    const card = scoreCall([
      { customer: "yes", max: "Awesome, great to connect with you! How has your experience been with our team so far?", beat: 0 },
      { customer: "good", max: "Glad to hear that! … recorded audio and video … okay.", beat: 1 },
      { customer: "okay", max: "First I see that you agreed to buy … have you got the chance to drive", beat: 2 },
      { customer: "yes I drove it", max: "Awesome! When you came back from the test drive …", beat: 3 },
    ]);
    expect(card.failed).toBe(0);
    expect(card.furthestBeat).toBe(3);
  });

  it("07a31a6d: Max back at the opener mid-call fails 'no_restart'", () => {
    expect(
      failed([
        { customer: "yes", max: "Before I start … recorded audio and video", beat: 1 },
        { customer: "I drove it", max: "Awesome! When you came back from the test drive", beat: 3 },
        { customer: "no he didn't", max: "Awesome, great to connect with you! First of all, congratulations on your new vehicle...", beat: 0 },
      ])
    ).toContain("no_restart");
  });

  it("888ec8fb: 'up' moving the coverage question to the close fails 'fragment_not_answer'", () => {
    expect(
      failed([
        { customer: "yeah", max: "Which two of those do you see the most value in?", beat: 23 },
        { customer: "up", max: "Great, so to confirm, we're moving forward … Are you ready to finalize?", beat: 24 },
      ])
    ).toContain("fragment_not_answer");
  });

  it("888ec8fb: 'no' to $4 answered with the same $4 pitch fails 'ladder_on_no'", () => {
    expect(
      failed([
        { customer: "proceed", max: "You can get everything i just mentioned for only four dollars a day", beat: 22 },
        { customer: "no", max: "Allow me to go over it … only four dollars a day a coffee a day", beat: 22 },
      ])
    ).toContain("ladder_on_no");
  });

  it("'no' answered with $3.50 passes", () => {
    expect(
      failed([
        { customer: "proceed", max: "You can get everything i just mentioned for only four dollars a day", beat: 22 },
        { customer: "no", max: "the best I can offer directly is three dollars and fifty cents a day.", beat: 23 },
      ])
    ).not.toContain("ladder_on_no");
  });

  it("three times in a row is a loop, twice is only flagged as robotic; a price under the floor fails", () => {
    const line = { customer: "hi", max: "Can you hear and see me alright?", beat: 0 };
    expect(failed([line, line, line])).toContain("no_loop");
    expect(failed([line, line])).toEqual(["varied_reask"]);
    expect(scoreCall([line, line]).checks.find((c) => c.id === "varied_reask")?.severity).toBe("soft");
    // "twenty five dollar for every oil change" is not a daily price
    expect(failed([{ customer: "ok", max: "you pay a hundred twenty five dollar for every oil change", beat: 18 }])).toEqual([]);
    expect(failed([{ customer: "lower", max: "I can do two dollars a day for you", beat: 23 }])).toContain("price_approved");
  });
});
