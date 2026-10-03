import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DuplicateCancellationError,
  NotFoundError,
  ValidationError,
  round2,
} from "@/lib/api-error";
import { recordMovement } from "@/lib/services/ledger";
import { deductStock, addStock } from "@/lib/services/inventory";
import { nextNumberFromList } from "@/lib/services/sequence";
import { toISO } from "@/lib/serialize";
import type {
  CreateInvoiceRequest,
  Customer,
  Invoice,
  InvoicePayment,
  PaymentMethod,
  RecordPaymentRequest,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Invoicing service — create+confirm and cancel (stock reversal).
// Every stock mutation is paired with a ledger row inside the
// same interactive transaction.
// ─────────────────────────────────────────────────────────────

export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: {
    customer: true;
    items: { include: { product: true } };
    payments: { orderBy: { paidAt: "asc" } };
  };
}>;

/** Maps a Prisma InvoicePayment row to the shared contract shape. */
export function mapPayment(p: {
  id: number;
  invoiceId: number;
  amount: number;
  method: string;
  notes: string | null;
  paidAt: Date;
  voidedAt?: Date | null;
  voidReason?: string | null;
}): InvoicePayment {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    amount: round2(p.amount),
    method: p.method as PaymentMethod,
    notes: p.notes,
    paidAt: toISO(p.paidAt),
    voidedAt: p.voidedAt ? toISO(p.voidedAt) : null,
    voidReason: p.voidReason ?? null,
  };
}

/** Maps a Prisma Customer row to the shared Customer contract shape. */
export function mapCustomer(customer: {
  id: number;
  companyName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  gstNumber: string | null;
  createdAt: Date;
}): Customer {
  return {
    id: customer.id,
    companyName: customer.companyName,
    contactPerson: customer.contactPerson,
    phone: customer.phone,
    email: customer.email,
    billingAddress: customer.billingAddress,
    shippingAddress: customer.shippingAddress,
    gstNumber: customer.gstNumber,
    createdAt: toISO(customer.createdAt),
  };
}

/** Maps a Prisma invoice (+relations) to the shared Invoice contract shape. */
export function mapInvoice(invoice: InvoiceWithRelations): Invoice {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    customerName: invoice.customer?.companyName ?? null,
    customer: invoice.customer ? mapCustomer(invoice.customer) : undefined,
    invoiceDate: toISO(invoice.invoiceDate),
    subtotal: round2(invoice.subtotal),
    taxTotal: round2(invoice.taxTotal),
    grandTotal: round2(invoice.grandTotal),
    status: invoice.status as Invoice["status"],
    paidAt: invoice.paidAt ? toISO(invoice.paidAt) : null,
    paidAmount: round2(invoice.paidAmount ?? 0),
    paymentMethod: invoice.paymentMethod ?? null,
    paymentNotes: invoice.paymentNotes ?? null,
    cancellationReason: invoice.cancellationReason,
    cancelledAt: invoice.cancelledAt ? toISO(invoice.cancelledAt) : null,
    payments: (invoice.payments ?? []).map(mapPayment),
    items: invoice.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product.name,
      lotNumber: i.lotNumber,
      quantity: round2(i.quantity),
      unitPrice: round2(i.unitPrice),
      taxRatePercent: round2(i.taxRatePercent),
      taxAmount: round2(i.taxAmount),
      lineTotal: round2(i.lineTotal),
    })),
  };
}

/** INV-XXXX = MAX(numeric suffix)+1 across existing invoice numbers. */
async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const existing = await tx.invoice.findMany({
      where: { invoiceNumber: { startsWith: "INV-" } },
      select: { invoiceNumber: true },
    });
    const candidate = nextNumberFromList(existing.map((i) => i.invoiceNumber), "INV");
    const clash = await tx.invoice.findUnique({ where: { invoiceNumber: candidate } });
    if (!clash) return candidate;
  }
  throw new Error("Unable to allocate a unique invoice number after 25 attempts.");
}

function parseDate(value: string | undefined, field: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ValidationError(`${field} is not a valid ISO date string.`);
  return d;
}

/**
 * Creates an invoice and confirms it atomically:
 *  - each line: atomic stock deduction (409-style guard → 400 on shortage),
 *    tax = qty × unitPrice × gst% / 100, lineTotal = qty × unitPrice + tax
 *  - SALE ledger row per line (referenceNumber = invoiceNumber)
 * Status starts (and ends) as CONFIRMED.
 */
export async function createAndConfirmInvoice(data: CreateInvoiceRequest): Promise<Invoice> {
  const invoiceDate = parseDate(data.invoiceDate, "invoiceDate");

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new NotFoundError(`Customer with id ${data.customerId} not found.`);

    const invoiceNumber = await nextInvoiceNumber(tx);

    let subtotal = 0;
    let taxTotal = 0;
    const lines: {
      productId: number;
      productName: string;
      lotNumber: string;
      quantity: number;
      unitPrice: number;
      taxRatePercent: number;
      taxAmount: number;
      lineTotal: number;
      balanceAfter: number;
    }[] = [];

    for (const item of data.items) {
      const product = await tx.finishedProduct.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new NotFoundError(`Finished product with id ${item.productId} not found.`);
      }

      const updated = await deductStock(tx, "finishedProduct", product.id, item.quantity);

      const taxAmount = round2(
        (item.quantity * product.sellingPrice * product.taxRatePercent) / 100
      );
      const lineTotal = round2(item.quantity * product.sellingPrice + taxAmount);

      subtotal += item.quantity * product.sellingPrice;
      taxTotal += taxAmount;

      lines.push({
        productId: product.id,
        productName: product.name,
        lotNumber: item.lotNumber,
        quantity: item.quantity,
        unitPrice: product.sellingPrice,
        taxRatePercent: product.taxRatePercent,
        taxAmount,
        lineTotal,
        balanceAfter: updated.currentStock,
      });
    }

    subtotal = round2(subtotal);
    taxTotal = round2(taxTotal);
    const grandTotal = round2(subtotal + taxTotal);

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: data.customerId,
        invoiceDate,
        subtotal,
        taxTotal,
        grandTotal,
        status: "CONFIRMED",
      },
    });

    for (const line of lines) {
      await tx.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          productId: line.productId,
          lotNumber: line.lotNumber,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRatePercent: line.taxRatePercent,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
        },
      });
      await recordMovement(tx, {
        itemType: "FINISHED_PRODUCT",
        itemId: line.productId,
        itemName: line.productName,
        referenceType: "SALE",
        referenceNumber: invoiceNumber,
        lotNumber: line.lotNumber,
        stockOut: line.quantity,
        balanceAfter: line.balanceAfter,
        unitRate: line.unitPrice,
        notes: `Sold to ${customer.companyName}`,
      });
    }

    const full = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    return mapInvoice(full);
  });
}

/**
 * Cancels an invoice: reverses stock for every line (addStock +
 * INVOICE_CANCELLATION ledger row with referenceNumber REV-<invoice>),
 * stamps cancelledAt/cancellationReason. Cancelling twice → 409.
 */
export async function cancelInvoice(invoiceId: number, reason: string): Promise<Invoice> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (!invoice) throw new NotFoundError(`Invoice with id ${invoiceId} not found.`);
    if (invoice.status === "CANCELLED") {
      throw new DuplicateCancellationError("Invoice is already cancelled.");
    }

    for (const item of invoice.items) {
      const updated = await addStock(tx, "finishedProduct", item.productId, item.quantity);
      await recordMovement(tx, {
        itemType: "FINISHED_PRODUCT",
        itemId: item.productId,
        itemName: item.product.name,
        referenceType: "INVOICE_CANCELLATION",
        referenceNumber: `REV-${invoice.invoiceNumber}`,
        lotNumber: item.lotNumber,
        stockIn: item.quantity,
        balanceAfter: updated.currentStock,
        unitRate: item.unitPrice,
        notes: `Reversal of ${invoice.invoiceNumber}: ${reason}`,
      });
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    const full = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    return mapInvoice(full);
  });
}

/**
 * Records a customer payment against a confirmed invoice.
 *  - No amount (or undefined) → full settlement of the remaining balance
 *    (back-compatible with the original boolean mark-paid flow).
 *  - With an amount → partial payment: paidAmount accumulates; the invoice
 *    is fully settled (paidAt stamped) only when the balance reaches zero.
 *  - Errors: 404 missing, 400 cancelled / non-positive amount / overpay,
 *    409 when the invoice is already fully settled.
 */
export async function markInvoicePaid(
  invoiceId: number,
  payment?: RecordPaymentRequest
): Promise<Invoice> {
  const EPS = 0.005; // half-paisa tolerance for float rounding

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (!invoice) throw new NotFoundError(`Invoice with id ${invoiceId} not found.`);
    if (invoice.status === "CANCELLED") {
      throw new ValidationError("A cancelled invoice cannot be marked as paid.");
    }
    if (invoice.paidAt) {
      throw new DuplicateCancellationError(
        `Invoice ${invoice.invoiceNumber} was already marked paid.`
      );
    }

    const balanceDue = round2(invoice.grandTotal - (invoice.paidAmount ?? 0));
    if (balanceDue <= EPS) {
      // Defensive: paidAt should already be set — treat as fully settled.
      throw new DuplicateCancellationError(
        `Invoice ${invoice.invoiceNumber} is already fully settled.`
      );
    }

    let amount = balanceDue;
    if (payment?.amount !== undefined && payment.amount !== null) {
      if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
        throw new ValidationError("Payment amount must be a positive number.");
      }
      amount = round2(payment.amount);
      if (amount > balanceDue + EPS) {
        throw new ValidationError(
          `Payment ${amount} exceeds the outstanding balance of ${balanceDue} for ${invoice.invoiceNumber}.`
        );
      }
    }

    const newPaid = round2((invoice.paidAmount ?? 0) + amount);
    const fullySettled = newPaid >= invoice.grandTotal - EPS;

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: fullySettled ? invoice.grandTotal : newPaid,
        paidAt: fullySettled ? new Date() : null,
        ...(payment?.method ? { paymentMethod: payment.method } : {}),
        ...(payment?.notes?.trim() ? { paymentNotes: payment.notes.trim() } : {}),
      },
    });

    // Append the immutable per-payment receipt row (payment history ledger).
    await tx.invoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        method: payment?.method ?? "CASH",
        ...(payment?.notes?.trim() ? { notes: payment.notes.trim() } : {}),
      },
    });

    const full = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    return mapInvoice(full);
  });
}

/**
 * Voids a payment receipt (mis-recorded payment correction):
 *  - the receipt row is NEVER deleted — voidedAt/voidReason are stamped so the
 *    receipt history stays auditable;
 *  - paidAmount is recomputed as the sum of active (non-voided) receipts;
 *  - paidAt is cleared when the recomputed total falls below the grand total
 *    (a settled invoice reverts to DUE/PARTIAL);
 *  - paymentMethod/paymentNotes fall back to the latest active receipt (or null).
 *  - Errors: 404 missing invoice/receipt, 400 cancelled invoice,
 *    409 already-voided receipt.
 */
export async function voidInvoicePayment(
  invoiceId: number,
  paymentId: number,
  reason: string
): Promise<Invoice> {
  const EPS = 0.005;

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (!invoice) throw new NotFoundError(`Invoice with id ${invoiceId} not found.`);
    if (invoice.status === "CANCELLED") {
      throw new ValidationError("A cancelled invoice has no live payments to void.");
    }

    const payment = invoice.payments.find((p) => p.id === paymentId);
    if (!payment) {
      throw new NotFoundError(
        `Payment receipt #${paymentId} not found on invoice ${invoice.invoiceNumber}.`
      );
    }
    if (payment.voidedAt) {
      throw new DuplicateCancellationError(
        `Payment receipt #${paymentId} was already voided.`
      );
    }

    // Stamp the void audit trail on the receipt (append-only spirit: no delete).
    await tx.invoicePayment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidReason: reason },
    });

    // Recompute the settlement state from active receipts only.
    const active = invoice.payments.filter((p) => p.id !== paymentId && !p.voidedAt);
    const newPaid = round2(active.reduce((s, p) => s + p.amount, 0));
    const fullySettled = newPaid >= invoice.grandTotal - EPS;
    const latestActive = active.length > 0 ? active[active.length - 1] : null;

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: fullySettled ? invoice.grandTotal : newPaid,
        paidAt: fullySettled ? (invoice.paidAt ?? new Date()) : null,
        paymentMethod: latestActive?.method ?? null,
        paymentNotes: latestActive?.notes ?? null,
      },
    });

    const full = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        customer: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    return mapInvoice(full);
  });
}

/** Invoices, newest first, with customer + line product names. */
export async function listInvoices(take?: number): Promise<Invoice[]> {
  const invoices = await db.invoice.findMany({
    orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
    ...(take ? { take } : {}),
    include: {
      customer: true,
      items: { include: { product: true } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  return invoices.map(mapInvoice);
}

/** Single invoice by id (404 if missing) with full customer + items. */
export async function getInvoice(id: number): Promise<Invoice> {
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { product: true } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!invoice) throw new NotFoundError(`Invoice with id ${id} not found.`);
  return mapInvoice(invoice);
}
