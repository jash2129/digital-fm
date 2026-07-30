import { PricingPanel } from "@/components/pricing-panel";

export default function PricingMaintenancePage() {
  return (
    <PricingPanel
      eyebrow="Protection Package · Part 2 of 4"
      title="5-Year Maintenance Cover"
      description="Routine scheduled maintenance for the next five years, taken care of — no more paying out of pocket every time it's due."
      bullets={[
        "Full synthetic oil changes",
        "Filters",
        "Tire rotations",
        "Covers the next 5 years of scheduled service",
      ]}
    />
  );
}
