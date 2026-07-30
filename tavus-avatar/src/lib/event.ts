export function isFinanceEvent() {
  return (process.env.EVENT_CONFIG || "").trim() === "digital-finance-manager";
}
