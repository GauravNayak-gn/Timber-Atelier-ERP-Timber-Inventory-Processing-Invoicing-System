/** Serializes a Date (or ISO string) to a contract-compliant ISO string. */
export function toISO(d: Date | string | null | undefined): string {
  if (!d) return "";
  return typeof d === "string" ? d : d.toISOString();
}
