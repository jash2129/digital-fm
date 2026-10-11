import { NextResponse } from "next/server";

import { isFinanceEvent } from "@/lib/event";
import { getApprovedDailyRates, getOrderedProductKeys, getPricingConfig } from "@/lib/pricing-config";

export async function GET() {
  if (!isFinanceEvent()) {
    return NextResponse.json({ error: "Not available for this event." }, { status: 404 });
  }

  const config = getPricingConfig();
  const products = getOrderedProductKeys(config).map((key) => ({
    key,
    label: config.products[key].label,
  }));

  return NextResponse.json(
    {
      products,
      tiersUsd: getApprovedDailyRates(config),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
