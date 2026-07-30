import { PricingPanel } from "@/components/pricing-panel";

export default function PricingTireWheelPage() {
  return (
    <PricingPanel
      eyebrow="Protection Package · Part 3 of 4"
      title="5-Year Tire & Wheel Coverage"
      description="Potholes, blowouts, and road hazards happen — this covers the tires and wheels for the next five years."
      bullets={[
        "Blowouts and road-hazard tire damage replaced at no cost",
        "Cosmetic rim damage from potholes repaired",
        "Covers the next 5 years",
      ]}
    />
  );
}
