import { PricingPanel } from "@/components/pricing-panel";

export default function PricingGapPage() {
  return (
    <PricingPanel
      eyebrow="Protection Package · Part 4 of 4"
      title="GAP Coverage"
      description="If the vehicle is totaled, stolen, or destroyed and the insurance payout doesn't cover the full loan balance, GAP covers the difference — so you're not paying out of pocket on a vehicle you no longer own."
      bullets={[
        "Covers the gap between insurance payout and loan balance",
        "Applies to accident, theft, hail, flood, and fire total losses",
        "No out-of-pocket balance left on a vehicle you no longer have",
      ]}
    />
  );
}
