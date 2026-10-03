// ─────────────────────────────────────────────────────────────
// Human-readable sequence numbers: PB-0001, INV-0002 …
// Derives the next value from the MAX numeric suffix of existing
// identifiers sharing the prefix (robust against gaps from
// deletions or re-seeds).
// ─────────────────────────────────────────────────────────────

export function nextNumberFromList(existing: string[], prefix: string): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const value of existing) {
    const m = re.exec(value);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
