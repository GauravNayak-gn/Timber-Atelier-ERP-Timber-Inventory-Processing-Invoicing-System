import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Domain error classes — thrown by services, mapped to HTTP
// responses by handleApiError().
// ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

/** 400 — validation failure, bad request body, non-positive quantity… */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

/** 400 — atomic stock guard tripped (available < requested). */
export class InsufficientStockError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = "InsufficientStockError";
  }
}

/** 404 — referenced entity does not exist. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/** 409 — invoice cancelled twice. */
export class DuplicateCancellationError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = "DuplicateCancellationError";
  }
}

/** Round a monetary/quantity value to 2 decimals (avoids FP drift). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function zodMessage(error: unknown): string {
  // zod v4 — issues carry path + message
  const issues = (error as { issues?: { path: (string | number | symbol)[]; message: string }[] }).issues ?? [];
  if (issues.length === 0) return "Invalid request body";
  const first = issues[0];
  const path = first.path.length > 0 ? `${first.path.map(String).join(".")}: ` : "";
  return `${path}${first.message}`;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2002" || e.code === "P2004")
  );
}

/**
 * Maps any thrown value to a proper NextResponse:
 *  - AppError subclasses → their declared status with { error }
 *  - Zod validation failures → 400 with { error }
 *  - Prisma unique-constraint violations → 400 with { error }
 *  - everything else → 500 { error: "Internal server error" }
 */
export function handleApiError(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof Error && e.name === "ZodError") {
    return NextResponse.json({ error: zodMessage(e) }, { status: 400 });
  }
  if (isUniqueViolation(e)) {
    const meta = (e as Prisma.PrismaClientKnownRequestError).meta as { target?: string[] } | undefined;
    const field = meta?.target?.join(", ");
    return NextResponse.json(
      { error: field ? `A record with this ${field} already exists.` : "A record with these unique values already exists." },
      { status: 400 }
    );
  }
  console.error("[api] unhandled error:", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
