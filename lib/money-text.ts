/** "Payment of ₹4,248 received" -> "Payment of (amount hidden) received" (history lines for people who may not see prices). */
export function hideRupees(text: string): string {
  return text.replace(/(?:₹|Rs\.?\s?)\s?[\d,]+(?:\.\d+)?/g, "(amount hidden)");
}
