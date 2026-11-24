import { NextResponse } from "next/server";
import { deleteRephrasing, loadRephrasings } from "@/lib/learned-phrasing";

// The rewordings TXM coached in calls, which Max uses in every call (src/lib/learned-phrasing.ts).
// GET lists them; DELETE ?id=<id> removes one that came out wrong. Behind DEMO_API_TOKEN (src/proxy.ts).
export async function GET() {
  return NextResponse.json({ rephrasings: await loadRephrasings(true) });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const removed = await deleteRephrasing(id);
  return NextResponse.json({ removed }, { status: removed ? 200 : 404 });
}
