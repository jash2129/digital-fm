/**
 * Beat 6 states the factory warranty of the car on the deal, from TXM's brand table (2026-11-22);
 * the approved wording around the brand and the two figures is unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import { factoryWarranty } from "./factory-warranty";
import { BEATS, renderBeatText, getFullBeatUtterance, renderFactoryWarranty } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG, HYUNDAI_DEAL_CONFIG } from "./deal-config";

const beat6 = BEATS.find((b) => b.id === 6)!;

describe("factory warranty in Beat 6", () => {
  it("a Mazda buyer hears Mazda's warranty: 3 years / 36,000 basic, 5 years / 60,000 powertrain", () => {
    const t = renderBeatText(beat6, DEFAULT_DEAL_CONFIG);
    expect(t).toContain("Mazda is like any other manufacturer");
    expect(t).toContain("three years thirty-six thousand mile Base limited warranty");
    expect(t).toContain("five years sixty thousand mile powertrain");
    expect(t).not.toContain("ten years hundred thousand mile powertrain");
  });

  it("a Hyundai buyer hears Hyundai's: 5 years / 60,000 basic, 10 years / 100,000 powertrain", () => {
    const t = getFullBeatUtterance(beat6, HYUNDAI_DEAL_CONFIG);
    expect(t).toContain("Hyundai is like any other manufacturer");
    expect(t).toContain("five years sixty thousand mile Base limited warranty");
    expect(t).toContain("ten years one hundred thousand mile powertrain");
  });

  it("brand names follow the table, case and spacing aside", () => {
    expect(factoryWarranty("Lexus")).toEqual({ basic: "four years fifty thousand mile", powertrain: "six years seventy thousand mile" });
    expect(factoryWarranty(" land   rover ")).toEqual({ basic: "four years fifty thousand mile", powertrain: "four years fifty thousand mile" });
    expect(factoryWarranty("Infiniti")?.basic).toBe("four years sixty thousand mile");
  });

  it("a make with no single figure in TXM's table keeps the approved text, and says so in the logs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(factoryWarranty("Tesla")).toBeNull();
    expect(renderFactoryWarranty(beat6.text, "Tesla")).toBe(beat6.text);
    expect(String(warn.mock.calls[0][0])).toContain("factory_warranty_unknown");
    warn.mockRestore();
  });

  it("only Beat 6 changes; the rest of the script renders as before", () => {
    for (const b of BEATS.filter((x) => x.id !== 6 && x.id !== 24)) {
      expect(renderBeatText(b, DEFAULT_DEAL_CONFIG), `beat ${b.id}`).not.toContain("three years thirty-six thousand");
    }
  });
});
