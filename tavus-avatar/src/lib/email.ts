import "server-only";

import nodemailer from "nodemailer";

// Sends the "customer wants a human" escalation notification over Gmail SMTP. Requires
// SMTP_USER (a Gmail address), SMTP_APP_PASSWORD (a Google App Password — NOT the account's
// regular login password; requires 2-Step Verification enabled first), and
// ESCALATION_EMAIL_TO (who receives the alert — can be the same address or a team inbox).
//
// If any of those are unset, sendEscalationEmail no-ops and returns false — escalation still
// gets logged (see conversation-usage.ts / escalation/route.ts), it just won't email anyone.
// This is deliberate: a misconfigured mailer should degrade to "no email," not break the
// customer-facing hand-off panel.

export type EscalationEmailPayload = {
  conversationId: string | null;
  reason: string | null;
  timestamp: string;
  customerName?: string | null;
  vehicle?: {
    year?: string;
    make?: string;
    model?: string;
  } | null;
};

function getMailerConfig() {
  const user = process.env.SMTP_USER;
  const appPassword = process.env.SMTP_APP_PASSWORD;
  const to = process.env.ESCALATION_EMAIL_TO;

  if (!user || !appPassword || !to) {
    return null;
  }

  return { user, appPassword, to };
}

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(user: string, appPassword: string) {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass: appPassword },
    });
  }

  return cachedTransporter;
}

function formatReadableTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return `${date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

function formatVehicle(vehicle: EscalationEmailPayload["vehicle"]): string | null {
  if (!vehicle) return null;
  const parts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Tavus conversation URLs consistently follow this pattern in practice
 * (https://tavus.daily.co/{conversation_id}), but that isn't a documented guarantee — if Tavus
 * ever changes it, this link just stops working (fails gracefully, doesn't break anything else).
 */
function buildJoinUrl(conversationId: string): string {
  return `https://tavus.daily.co/${conversationId}`;
}

/** Returns true if an email was actually sent, false if mailer isn't configured or sending failed. */
export async function sendEscalationEmail(payload: EscalationEmailPayload): Promise<boolean> {
  const config = getMailerConfig();

  if (!config) {
    return false;
  }

  const vehicleText = formatVehicle(payload.vehicle);

  // Primarily a QA/compliance log entry for later review — but since a team member joining
  // the live call *while it's still active* is genuinely possible (Tavus/Daily rooms support
  // multiple participants), the join link is included as a best-effort real-time option, not
  // the main point of the email.
  const subject = `Digital Finance Manager — escalation log entry (${payload.conversationId ?? "unknown call"})`;
  const text = [
    "Log entry: a customer on a Digital Finance Manager call asked to speak with a real person.",
    "This is primarily a record for review — but if the call is still active, you can join it",
    "directly using the link below.",
    "",
    `When: ${formatReadableTimestamp(payload.timestamp)}`,
    `Conversation ID: ${payload.conversationId ?? "(unknown)"}`,
    ...(payload.customerName ? [`Customer: ${payload.customerName}`] : []),
    ...(vehicleText ? [`Vehicle: ${vehicleText}`] : []),
    `AI's internal note on why it escalated: ${payload.reason ?? "(not provided)"}`,
    "",
    payload.conversationId
      ? `Join the call now (only works if it's still active): ${buildJoinUrl(payload.conversationId)}`
      : "No conversation ID available — can't build a join link for this one.",
  ].join("\n");

  try {
    await getTransporter(config.user, config.appPassword).sendMail({
      from: config.user,
      to: config.to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.error("[escalation email] failed to send", error);
    return false;
  }
}
