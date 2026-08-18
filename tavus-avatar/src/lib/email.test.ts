import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

describe("sendEscalationEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    sendMailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false and never calls nodemailer when unconfigured", async () => {
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_APP_PASSWORD", "");
    vi.stubEnv("ESCALATION_EMAIL_TO", "");

    const { sendEscalationEmail } = await import("./email");
    const result = await sendEscalationEmail({
      conversationId: "conv-1",
      reason: "test",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("returns false when only some env vars are set", async () => {
    vi.stubEnv("SMTP_USER", "someone@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");

    const { sendEscalationEmail } = await import("./email");
    const result = await sendEscalationEmail({
      conversationId: "conv-1",
      reason: "test",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends via Gmail SMTP with the right fields when fully configured", async () => {
    vi.stubEnv("SMTP_USER", "sender@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "app-password-123");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");

    const { sendEscalationEmail } = await import("./email");
    const result = await sendEscalationEmail({
      conversationId: "conv-42",
      reason: "customer requested below floor",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toBe(true);
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "gmail",
        auth: { user: "sender@gmail.com", pass: "app-password-123" },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "sender@gmail.com",
        to: "team@example.com",
        subject: expect.stringContaining("conv-42"),
        text: expect.stringContaining("conv-42"),
      }),
    );

    const sentText = sendMailMock.mock.calls[0][0].text as string;
    // Framed primarily as a log entry for review.
    expect(sentText).toContain("primarily a record for review");
    // Human-readable, not raw ISO — the payload used 2026-01-01T00:00:00.000Z.
    expect(sentText).toContain("Thursday, January 1, 2026");
    expect(sentText).not.toContain("2026-01-01T00:00:00.000Z");
    // Join link built from the conversation id.
    expect(sentText).toContain("https://tavus.daily.co/conv-42");
  });

  it("includes customer name and vehicle when provided", async () => {
    vi.stubEnv("SMTP_USER", "sender@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "app-password-123");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");

    const { sendEscalationEmail } = await import("./email");
    await sendEscalationEmail({
      conversationId: "conv-42",
      reason: "customer requested below floor",
      timestamp: "2026-01-01T00:00:00.000Z",
      customerName: "Jordan Lee",
      vehicle: { year: "2026", make: "Hyundai", model: "Tucson" },
    });

    const sentText = sendMailMock.mock.calls[0][0].text as string;
    expect(sentText).toContain("Customer: Jordan Lee");
    expect(sentText).toContain("Vehicle: 2026 Hyundai Tucson");
  });

  it("omits customer/vehicle lines entirely when not provided", async () => {
    vi.stubEnv("SMTP_USER", "sender@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "app-password-123");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");

    const { sendEscalationEmail } = await import("./email");
    await sendEscalationEmail({
      conversationId: "conv-42",
      reason: "customer requested below floor",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const sentText = sendMailMock.mock.calls[0][0].text as string;
    expect(sentText).not.toContain("Customer:");
    expect(sentText).not.toContain("Vehicle:");
  });

  it("handles a partial vehicle (missing make) without an extra space", async () => {
    vi.stubEnv("SMTP_USER", "sender@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "app-password-123");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");

    const { sendEscalationEmail } = await import("./email");
    await sendEscalationEmail({
      conversationId: "conv-42",
      reason: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      vehicle: { year: "2026", model: "Tucson" },
    });

    const sentText = sendMailMock.mock.calls[0][0].text as string;
    expect(sentText).toContain("Vehicle: 2026 Tucson");
  });

  it("omits the join link and explains why when conversationId is missing", async () => {
    vi.stubEnv("SMTP_USER", "sender@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "app-password-123");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");

    const { sendEscalationEmail } = await import("./email");
    await sendEscalationEmail({
      conversationId: null,
      reason: null,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const sentText = sendMailMock.mock.calls[0][0].text as string;
    expect(sentText).not.toContain("tavus.daily.co");
    expect(sentText).toContain("can't build a join link");
  });

  it("returns false (not throws) when sendMail rejects", async () => {
    vi.stubEnv("SMTP_USER", "sender@gmail.com");
    vi.stubEnv("SMTP_APP_PASSWORD", "app-password-123");
    vi.stubEnv("ESCALATION_EMAIL_TO", "team@example.com");
    sendMailMock.mockRejectedValueOnce(new Error("SMTP down"));

    const { sendEscalationEmail } = await import("./email");
    const result = await sendEscalationEmail({
      conversationId: "conv-1",
      reason: null,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toBe(false);
  });
});
