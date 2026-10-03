// ─────────────────────────────────────────────────────────────
// Timber ERP — Shared API contract types (single source of truth)
// ─────────────────────────────────────────────────────────────

export type ItemType = "RAW_MATERIAL" | "FINISHED_PRODUCT";
export type ReferenceType =
  | "PURCHASE"
  | "PROCESSING_INPUT"
  | "PROCESSING_OUTPUT"
  | "SALE"
  | "INVOICE_CANCELLATION"
  | "BATCH_CANCELLATION"
  | "ADJUSTMENT";
export type OutputType = "FINISHED" | "SECONDARY" | "WASTE";
export type InvoiceStatus = "CONFIRMED" | "CANCELLED";
export type BatchStatus = "COMPLETED" | "CANCELLED";
export type PaymentMethod = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";

// ── Partners ──
export interface Supplier {
  id: number;
  companyName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  createdAt: string;
}

export interface Customer {
  id: number;
  companyName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  gstNumber?: string | null;
  createdAt: string;
}

// ── Inventory ──
export interface RawMaterial {
  id: number;
  name: string;
  skuCode: string;
  category: string;
  unit: string;
  currentStock: number;
  unitPurchaseRate: number;
  reorderThreshold: number;
  createdAt: string;
}

export interface FinishedProduct {
  id: number;
  name: string;
  skuCode: string;
  category: string;
  unit: string;
  sellingPrice: number;
  taxRatePercent: number;
  currentStock: number;
  reorderThreshold: number;
  createdAt: string;
}

export interface LedgerEntry {
  id: number;
  timestamp: string;
  itemType: ItemType;
  itemId: number;
  itemName: string;
  referenceType: ReferenceType;
  referenceNumber: string;
  lotNumber: string;
  stockIn: number;
  stockOut: number;
  balanceAfter: number;
  unitRate: number;
  supplierId?: number | null;
  notes?: string | null;
}

// ── Processing ──
export interface BatchInputItem {
  id: number;
  rawMaterialId: number;
  rawMaterialName?: string;
  lotNumber: string;
  quantityConsumed: number;
  unit: string;
}

export interface BatchOutputItem {
  id: number;
  productId?: number | null;
  productName?: string;
  lotNumber: string;
  outputType: OutputType;
  quantityProduced: number;
  unit: string;
}

export interface ProcessingBatch {
  id: number;
  batchNumber: string;
  processingDate: string;
  notes?: string | null;
  wastePercentage: number;
  totalInputQty: number;
  totalOutputQty: number;
  totalWasteQty: number;
  status: BatchStatus;
  /** Set when the batch is reversed (stock restored/consumed back). */
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  inputs: BatchInputItem[];
  outputs: BatchOutputItem[];
}

// ── Invoicing ──
export interface InvoiceItem {
  id: number;
  productId: number;
  productName?: string;
  lotNumber: string;
  quantity: number;
  unitPrice: number;
  taxRatePercent: number;
  taxAmount: number;
  lineTotal: number;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName?: string;
  customer?: Customer;
  invoiceDate: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  status: InvoiceStatus;
  /** Set once the customer settles the bill in full (receivables tracking). */
  paidAt?: string | null;
  /** Cumulative payments received (partial payments allowed). */
  paidAmount?: number;
  /** Method of the most recent payment: CASH | UPI | BANK_TRANSFER | CHEQUE. */
  paymentMethod?: string | null;
  /** Reference/remarks for the most recent payment (UTR, cheque no., …). */
  paymentNotes?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  /** Immutable per-payment receipt rows, oldest first (v1.5+). */
  payments?: InvoicePayment[];
  items: InvoiceItem[];
}

/** A single payment receipt recorded against an invoice.
 *  Mis-recorded receipts are voided (never deleted) — voided rows stay in the
 *  history for audit but are excluded from paidAmount and settlement. */
export interface InvoicePayment {
  id: number;
  invoiceId: number;
  amount: number;
  method: PaymentMethod;
  notes?: string | null;
  paidAt: string;
  /** Set when this receipt was reversed — audit trail only. */
  voidedAt?: string | null;
  /** Why the receipt was voided (≥3 chars, recorded at void time). */
  voidReason?: string | null;
}

/** Optional body for POST /api/invoices/[id]/mark-paid — omit for full settlement. */
export interface RecordPaymentRequest {
  /** Payment amount; defaults to the full outstanding balance. */
  amount?: number;
  method?: PaymentMethod;
  /** Reference/remarks (UTR, cheque number, remarks). */
  notes?: string;
}

// ── Payables (supplier PO bills & payments) ──
/** A payment WE made to a SUPPLIER against a PO bill.
 *  Rows are append-only: mis-recorded payments are voided, never deleted. */
export interface SupplierPayment {
  id: number;
  supplierId: number;
  poNumber: string;
  amount: number;
  method: PaymentMethod;
  notes?: string | null;
  paidAt: string;
  /** Set when this receipt was reversed — audit trail only. */
  voidedAt?: string | null;
  /** Why the receipt was voided (≥3 chars, recorded at void time). */
  voidReason?: string | null;
}

/** Optional body for POST /api/suppliers/[id]/payments — amount defaults to the PO balance. */
export interface RecordSupplierPaymentRequest {
  poNumber: string;
  /** Payment amount; defaults to the full outstanding balance on the PO. */
  amount?: number;
  method?: PaymentMethod;
  notes?: string;
}

/** One supplier PO bill, derived from PURCHASE ledger rows (qty × unitRate)
 *  grouped by referenceNumber, joined with its payment receipts. */
export interface SupplierPoBill {
  poNumber: string;
  billed: number; // ₹ Σ(stockIn × unitRate) across the PO's purchase rows
  paid: number; // ₹ Σ active payments (voided rows excluded)
  outstanding: number; // billed − paid (never below 0)
  status: "UNPAID" | "PARTIAL" | "SETTLED";
  firstPurchaseDate: string; // age for payables aging
  lastPurchaseDate: string;
  ageDays: number;
  lineCount: number; // purchase ledger rows under this PO
  materials: string[]; // distinct material names received under the PO
  lots: string[]; // distinct lot numbers received under the PO
  payments: SupplierPayment[]; // oldest first, voided rows included
}

/** GET /api/suppliers/[id]/payables — full payables position for one supplier. */
export interface SupplierAgingSummary {
  supplierId: number;
  supplierName: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueTotal: number; // outstanding on bills older than 30 days
  overdueCount: number;
  buckets: { label: string; total: number; count: number }[]; // "0–30" … "90+"
  bills: SupplierPoBill[]; // oldest PO first
}

// ── Requests ──
export interface PurchaseRequest {
  materialId: number;
  supplierId: number;
  quantity: number;
  unitRate: number;
  lotNumber: string;
  poNumber: string;
}

export interface BatchInputRequest {
  rawMaterialId: number;
  lotNumber: string;
  quantity: number;
}

export interface BatchOutputRequest {
  productId?: number | null;
  lotNumber: string;
  outputType: OutputType;
  quantity: number;
}

export interface CreateBatchRequest {
  processingDate?: string;
  notes?: string;
  inputs: BatchInputRequest[];
  outputs: BatchOutputRequest[];
}

export interface InvoiceLineRequest {
  productId: number;
  lotNumber: string;
  quantity: number;
}

export interface CreateInvoiceRequest {
  customerId: number;
  invoiceDate?: string;
  items: InvoiceLineRequest[];
}

// ── Dashboard ──
/** Outstanding supplier PO bills grouped by bill age (mirror of ReceivablesSummary). */
export interface PayablesSummary {
  outstandingTotal: number; // ₹ owed to suppliers, active bills only
  paidTotal: number; // ₹ settled to date across ALL POs (voided receipts excluded)
  billCount: number; // PO bills with outstanding > 0
  supplierCount: number; // distinct suppliers owed money
  overdueTotal: number; // ₹ older than 30 days
  buckets: { label: string; total: number; count: number }[]; // "0–30", "31–60", "61–90", "90+"
  topCreditors: {
    supplierId: number;
    supplierName: string;
    total: number;
    billCount: number;
    oldestDays: number;
  }[];
}

/** Outstanding confirmed invoices grouped by invoice age. */
export interface ReceivablesSummary {
  outstandingTotal: number; // ₹ unpaid, CONFIRMED only
  collectedTotal: number; // ₹ settled to date (paidAt set)
  invoiceCount: number; // unpaid confirmed invoices
  overdueTotal: number; // ₹ older than 30 days
  buckets: { label: string; total: number; count: number }[]; // "0–30", "31–60", "61–90", "90+"
  topDebtors: {
    customerId: number;
    customerName: string;
    total: number;
    invoiceCount: number;
    oldestDays: number;
  }[];
}

export interface DashboardStats {
  kpis: {
    totalRawStock: number; // CFT
    rawInventoryValue: number; // ₹ (stock × purchase rate)
    totalFinishedStock: number; // CFT
    finishedInventoryValue: number; // ₹ (stock × selling price)
    overallWastePercent: number;
    monthSalesTotal: number; // ₹ (confirmed invoices this month)
    monthGstCollected: number;
    cancelledInvoiceCount: number;
    cancelledRefundValue: number;
    inventoryValue: number; // raw + finished
    /** Cash actually received this calendar month (active payment receipts
     *  on CONFIRMED invoices) — differs from monthSalesTotal which is billed. */
    collectedThisMonth: number;
  };
  receivables: ReceivablesSummary;
  /** Mirror of receivables on the supplier side — PO bills derived from the PURCHASE ledger. */
  payables: PayablesSummary;
  lowStockItems: {
    id: number;
    name: string;
    kind: ItemType;
    currentStock: number;
    unit: string;
    reorderThreshold: number;
  }[];
  recentBatches: ProcessingBatch[];
  recentInvoices: Invoice[];
  monthlySales: { month: string; sales: number; gst: number }[]; // last 6 months
  wasteMetrics: {
    batchNumber: string;
    wastePercent: number;
    processingDate: string;
    totalInputQty: number;
    totalWasteQty: number;
    status: BatchStatus;
  }[]; // recent 8 COMPLETED, newest first
  /** Newest ledger movements across every item — live activity feed. */
  recentActivity: LedgerEntry[];
}

// ── Traceability ──
export interface ForwardTrace {
  rootLot: string;
  material: { id: number; name: string; skuCode: string } | null;
  purchase: {
    poNumber: string;
    supplierName: string;
    supplierGst?: string | null;
    purchaseDate: string;
    quantity: number;
    unitRate: number;
  } | null;
  batches: {
    batchNumber: string;
    processingDate: string;
    consumedQty: number;
    wastePercentage: number;
    outputs: {
      lotNumber: string;
      outputType: OutputType;
      productName: string;
      quantityProduced: number;
    }[];
    invoices: {
      invoiceNumber: string;
      invoiceDate: string;
      status: InvoiceStatus;
      customerName: string;
      grandTotal: number;
      quantity: number;
    }[];
  }[];
}

export interface BackwardTrace {
  root: string; // invoice number or finished lot
  invoice: {
    invoiceNumber: string;
    invoiceDate: string;
    status: InvoiceStatus;
    customerName: string;
    customerGst?: string | null;
    grandTotal: number;
  } | null;
  lots: {
    lotNumber: string;
    productName: string;
    quantitySold: number;
    batch: {
      batchNumber: string;
      processingDate: string;
      wastePercentage: number;
    } | null;
    rawInputs: {
      lotNumber: string;
      materialName: string;
      quantityConsumed: number;
    }[];
    purchases: {
      poNumber: string;
      supplierName: string;
      supplierGst?: string | null;
      purchaseDate: string;
      quantity: number;
    }[];
  }[];
}

// ── AI ──
export interface AiQueryResponse {
  answer: string;
  toolsUsed: string[];
}

// ── Inventory adjustments (manual corrections with ledger trail) ──
export interface AdjustStockRequest {
  itemType: ItemType;
  itemId: number;
  direction: "IN" | "OUT";
  quantity: number;
  reason: string;
}

export interface AdjustStockResponse {
  item: RawMaterial | FinishedProduct;
  entry: LedgerEntry;
}

// ── Partners (suppliers & customers with derived activity stats) ──
export interface PartnerSupplier {
  id: number;
  companyName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  purchaseCount: number;
  purchaseValue: number; // ₹ (sum of stockIn × unitRate)
  totalQuantity: number;
  lastPurchaseDate: string | null;
  materials: string[]; // distinct material names supplied
}

export interface PartnerCustomer {
  id: number;
  companyName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  gstNumber?: string | null;
  invoiceCount: number;
  confirmedCount: number;
  cancelledCount: number;
  totalBilled: number; // ₹ (confirmed only)
  lastInvoiceDate: string | null;
}

export interface PartnerStats {
  suppliers: PartnerSupplier[];
  customers: PartnerCustomer[];
}
