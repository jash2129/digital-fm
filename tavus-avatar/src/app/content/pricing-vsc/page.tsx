import { PricingPanel } from "@/components/pricing-panel";

export default function PricingVscPage() {
  return (
    <PricingPanel
      eyebrow="Protection Package · Part 1 of 4"
      title="10-Year, 100,000-Mile Bumper-to-Bumper"
      description="Wraps a blanket-cover contract around the vehicle for wear-and-tear failures the factory warranty won't pay for — the same major components, but covered no matter what caused the breakdown."
      bullets={[
        "Engine and transmission",
        "Drive axle and four-wheel drive components",
        "Suspension and steering",
        "Electrical system",
        "Brakes",
        "Air conditioning and cooling system",
        "All high-tech accessories, including labor",
        "Zero deductible out of pocket",
      ]}
    />
  );
}
