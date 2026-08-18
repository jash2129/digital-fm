import { NextResponse } from "next/server";

import { createDeal, type DealContext } from "@/lib/deal-context";

type DealContextRequestBody = {
  customer_name?: unknown;
  vehicle?: {
    year?: unknown;
    make?: unknown;
    model?: unknown;
  };
  financing_terms?: unknown;
};

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as DealContextRequestBody | null;

  if (!body) {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { headers: { "Cache-Control": "no-store" }, status: 400 },
    );
  }

  const context: DealContext = {
    customerName: asOptionalString(body.customer_name),
    vehicle: {
      year: asOptionalString(body.vehicle?.year),
      make: asOptionalString(body.vehicle?.make),
      model: asOptionalString(body.vehicle?.model),
    },
    financingTerms: asOptionalString(body.financing_terms),
  };

  const hasAnyField =
    context.customerName ||
    context.financingTerms ||
    context.vehicle?.year ||
    context.vehicle?.make ||
    context.vehicle?.model;

  if (!hasAnyField) {
    return NextResponse.json(
      { error: "Provide at least one of customer_name, vehicle, or financing_terms." },
      { headers: { "Cache-Control": "no-store" }, status: 400 },
    );
  }

  const dealId = createDeal(context);

  return NextResponse.json(
    { deal_id: dealId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
