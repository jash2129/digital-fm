import { NextResponse } from "next/server";

import { getDealForConversation } from "@/lib/conversation-deals";
import { sendEscalationEmail } from "@/lib/email";

// Logs every escalate_to_human tool call for an audit trail, and emails a real notification
// via Gmail SMTP if SMTP_USER/SMTP_APP_PASSWORD/ESCALATION_EMAIL_TO are configured (see
// src/lib/email.ts). Sending never blocks or fails the response — the hand-off panel must
// show regardless of whether the email actually went out.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    conversationId?: string;
    reason?: string;
  };

  const conversationId = body.conversationId ?? null;
  const dealContext = conversationId ? getDealForConversation(conversationId) : undefined;

  const payload = {
    conversationId,
    reason: body.reason ?? null,
    timestamp: new Date().toISOString(),
    customerName: dealContext?.customerName ?? null,
    vehicle: dealContext?.vehicle ?? null,
  };

  console.warn("[escalate_to_human]", payload);

  const emailed = await sendEscalationEmail(payload);
  if (!emailed) {
    console.warn("[escalate_to_human] email not sent (mailer unconfigured or send failed)");
  }

  return NextResponse.json({ ok: true, emailed }, { headers: { "Cache-Control": "no-store" } });
}
