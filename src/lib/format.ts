/**
 * Timber ERP — formatting helpers (INR, quantities, dates).
 */

const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const inrRounded = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const qtyFmt = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

/** ₹ currency, en-IN grouping, trims to max 2 decimals. */
export function formatINR(value: number | null | undefined, opts?: { decimals?: 0 | 1 | 2 }): string {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (opts?.decimals === 0) return inrRounded.format(v);
  return inrFull.format(v);
}

/** Compact Indian notation for charts / sub-lines: ₹1.25 L, ₹2.4 Cr, ₹8.5K */
export function formatCompactINR(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${trim((abs / 1e7).toFixed(2))} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim((abs / 1e5).toFixed(2))} L`;
  if (abs >= 1e3) return `${sign}₹${trim((abs / 1e3).toFixed(1))}K`;
  return `${sign}₹${trim(abs.toFixed(0))}`;
}

function trim(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

/** Quantity with trailing zeros trimmed (1,000 · 460 · 12.5). */
export function formatQty(value: number | null | undefined): string {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return qtyFmt.format(v);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 Jan 2025" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** "12 Jan 2025, 14:30" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${formatDate(d)}, ${time}`;
}

/** Today as yyyy-mm-dd for <input type="date"> defaults. */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parses numeric input; NaN when invalid. */
export function parseNumber(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

/* ── CSV export ── */

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a header row + data rows. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

/** Download text content as a file (used for CSV exports). */
export function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
