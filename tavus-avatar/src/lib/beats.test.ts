import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import beatsData from "./beats.json";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

interface Beat {
  id: number;
  type: "wait" | "continue";
  text: string;
  check_in: string | null;
}

export function renderBeatText(beat: Beat, dealConfig = DEFAULT_DEAL_CONFIG): string {
  let rendered = beat.text;
  rendered = rendered.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
  rendered = rendered.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
  rendered = rendered.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
  rendered = rendered.replace(/\{\{per_day_price\}\}/g, dealConfig.per_day_price);
  return rendered;
}

describe("3.1 Beats Data Integrity Test", () => {
  const sourcePath = path.resolve(__dirname, "../../../docs/max-beat-prompt-v9.md");
  const sourceContent = fs.readFileSync(sourcePath, "utf8");

  it("has exactly 22 beats in beats.json", () => {
    expect(beatsData).toHaveLength(22);
  });

  beatsData.forEach((beat) => {
    it(`Beat ${beat.id} matches docs/max-beat-prompt-v9.md verbatim`, () => {
      // Find the beat block in docs/max-beat-prompt-v9.md
      const regex = new RegExp(
        `\\*\\*Beat\\s+${beat.id}\\s+·\\s+(WAIT|CONTINUE)[^\\*]*\\*\\*([\\s\\S]*?)(?=(?:\\*\\*Beat\\s+\\d+)|\\*\\*After Beat 22|$)`
      );
      const match = sourceContent.match(regex);
      expect(match, `Beat ${beat.id} block not found in source markdown`).toBeTruthy();

      const sourceBlock = match![2];
      const lines = sourceBlock.split("\n").map((l) => l.trim()).filter(Boolean);
      const spokenLine = lines.find((l) => l.startsWith('"'));
      expect(spokenLine, `No spoken line found for Beat ${beat.id}`).toBeTruthy();

      // Check check_in extraction
      let expectedCheckIn: string | null = null;
      let expectedSpokenText = spokenLine!;
      const checkInMatch = expectedSpokenText.match(/\s*—\s*\*([^*]+)\*\s*$/);
      if (checkInMatch) {
        expectedCheckIn = checkInMatch[1].trim();
        expectedSpokenText = expectedSpokenText.replace(/\s*—\s*\*([^*]+)\*\s*$/, "").trim();
      }

      // Verify check_in
      expect(beat.check_in).toBe(expectedCheckIn);

      // Verify beat type
      const expectedType = match![1].toLowerCase();
      expect(beat.type).toBe(expectedType);

      // Verify text with deal config placeholders substituted
      const rendered = renderBeatText(beat as Beat, DEFAULT_DEAL_CONFIG);
      expect(rendered).toBe(expectedSpokenText);
    });
  });
});
