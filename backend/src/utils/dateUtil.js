/**
 * ✅ Normalize a date to YYYY-MM-DD string
 * - If dateString is provided → normalize that date
 * - If not provided → use current date
 * - Always returns first day of the month
 */
export function getMonthStart(dateString) {
  let baseDate;

  if (dateString) {
    baseDate = new Date(dateString);
    if (isNaN(baseDate)) {
      throw new Error("Invalid date format. Use YYYY-MM-DD.");
    }
  } else {
    baseDate = new Date(); // default to now
  }

  // Normalize to first day of month
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);

  // Always return YYYY-MM-DD string
  return monthStart.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
