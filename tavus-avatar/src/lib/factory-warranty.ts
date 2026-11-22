/**
 * The manufacturer's own warranty per brand, as Max says it in Beat 6. Source: TXM's brand table,
 * 2026-11-22 (basic limited / powertrain, years / miles). Beat 6's approved text hard-coded "Mazda"
 * and Hyundai's 5 yr / 60k and 10 yr / 100k, so a Mazda buyer heard the wrong warranty; the beat now
 * takes the brand and the two figures from here (beats.json is unchanged).
 *
 * Only exact figures are listed. TXM's rows given as ranges or "generally" (Tesla, Rivian, Lucid,
 * Polestar, VinFast, the exotic brands) are left out on purpose: for those Beat 6 keeps its approved
 * wording until TXM gives one figure each. "*" rows (Hyundai group, Ram trucks) use the figures shown.
 */

export interface FactoryWarranty {
  /** spoken as in the script: "three years thirty-six thousand mile" */
  basic: string;
  powertrain: string;
}

const W = (basic: string, powertrain: string): FactoryWarranty => ({ basic, powertrain });

const MAINSTREAM = W("three years thirty-six thousand mile", "five years sixty thousand mile");
const HYUNDAI_GROUP = W("five years sixty thousand mile", "ten years one hundred thousand mile");
const PREMIUM = W("four years fifty thousand mile", "six years seventy thousand mile");
const EUROPEAN = W("four years fifty thousand mile", "four years fifty thousand mile");

const TABLE: Record<string, FactoryWarranty> = {
  mazda: MAINSTREAM,
  toyota: MAINSTREAM,
  honda: MAINSTREAM,
  nissan: MAINSTREAM,
  subaru: MAINSTREAM,
  chevrolet: MAINSTREAM,
  chevy: MAINSTREAM,
  gmc: MAINSTREAM,
  buick: MAINSTREAM,
  ford: MAINSTREAM,
  chrysler: MAINSTREAM,
  dodge: MAINSTREAM,
  jeep: MAINSTREAM,
  hyundai: HYUNDAI_GROUP,
  kia: HYUNDAI_GROUP,
  genesis: HYUNDAI_GROUP,
  mitsubishi: HYUNDAI_GROUP,
  acura: PREMIUM,
  lexus: PREMIUM,
  lincoln: PREMIUM,
  cadillac: PREMIUM,
  infiniti: W("four years sixty thousand mile", "six years seventy thousand mile"),
  audi: EUROPEAN,
  bmw: EUROPEAN,
  "mercedes-benz": EUROPEAN,
  mercedes: EUROPEAN,
  mini: EUROPEAN,
  porsche: EUROPEAN,
  volkswagen: EUROPEAN,
  vw: EUROPEAN,
  volvo: EUROPEAN,
  "alfa romeo": EUROPEAN,
  "land rover": EUROPEAN,
  "range rover": EUROPEAN,
  fiat: EUROPEAN,
  maserati: EUROPEAN,
  ram: W("three years thirty-six thousand mile", "ten years one hundred thousand mile"),
  ineos: W("five years sixty thousand mile", "five years sixty thousand mile"),
};

/** The brand's factory warranty, or null when TXM's table has no single figure for it */
export function factoryWarranty(make: string | undefined): FactoryWarranty | null {
  const key = (make ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return TABLE[key] ?? null;
}
