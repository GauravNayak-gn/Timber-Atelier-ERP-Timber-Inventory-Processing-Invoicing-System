import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// Shared zod v4 schema building blocks for API request parsing.
// ─────────────────────────────────────────────────────────────

/** Optional/nullable string; "" collapses to undefined (→ stored as null). */
export const optStr = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().optional().nullable()
);

/** Required non-empty string. */
export const reqStr = (label: string) =>
  z.string({ message: `${label} is required` }).trim().min(1, `${label} is required`);

/** ISO-parsable date string (validated, parsed later by the service). */
export const isoDate = z
  .string()
  .trim()
  .refine((v) => !isNaN(Date.parse(v)), "Must be a valid ISO date string");

/** Quantity: strictly positive (rejects 0 and negatives → 400). */
export const positiveQty = (label = "quantity") =>
  z
    .number({ message: `${label} must be a number` })
    .positive(`${label} must be greater than 0`);

/** Money/rate: zero or positive. */
export const nonNegative = (label: string) =>
  z
    .number({ message: `${label} must be a number` })
    .nonnegative(`${label} must be 0 or greater`);

/** Parses a JSON request body (empty/invalid JSON → {}), then validates it. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}
