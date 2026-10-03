/**
 * Timber ERP — typed API client.
 * Every endpoint returns JSON; errors come back as `{ error: string }`
 * with status 400/404/409. All calls throw `ApiError` with the server
 * message so views can surface it in toasts / error states.
 */
import type {
  AdjustStockRequest,
  AdjustStockResponse,
  AiQueryResponse,
  BackwardTrace,
  CreateBatchRequest,
  CreateInvoiceRequest,
  Customer,
  DashboardStats,
  FinishedProduct,
  ForwardTrace,
  Invoice,
  LedgerEntry,
  PartnerStats,
  ProcessingBatch,
  PurchaseRequest,
  RawMaterial,
  RecordPaymentRequest,
  RecordSupplierPaymentRequest,
  Supplier,
  SupplierAgingSummary,
} from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Network error — could not reach the server", 0);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const serverMessage =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(serverMessage, res.status);
  }

  return body as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  request<T>(path, { signal });

export const apiPost = <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> =>
  request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

/* ── Request payloads for endpoints without shared types ── */

export interface CreateSupplierInput {
  companyName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
}

export interface CreateCustomerInput {
  companyName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  billingAddress?: string;
  shippingAddress?: string;
  gstNumber?: string;
}

export interface CreateMaterialInput {
  name: string;
  skuCode: string;
  category: string;
  unit: string;
  unitPurchaseRate: number;
  reorderThreshold?: number;
}

export interface CreateProductInput {
  name: string;
  skuCode: string;
  category: string;
  unit: string;
  sellingPrice: number;
  taxRatePercent: number;
}

export interface LedgerQuery {
  entries: LedgerEntry[];
  total: number;
}

/* ── Typed endpoint helpers ── */

export const api = {
  // Dashboard
  dashboardStats: () => apiGet<DashboardStats>("/api/dashboard/stats"),

  // Partners
  suppliers: () => apiGet<Supplier[]>("/api/suppliers"),
  createSupplier: (body: CreateSupplierInput) => apiPost<Supplier>("/api/suppliers", body),
  customers: () => apiGet<Customer[]>("/api/customers"),
  createCustomer: (body: CreateCustomerInput) => apiPost<Customer>("/api/customers", body),

  // Raw materials
  materials: () => apiGet<RawMaterial[]>("/api/materials"),
  createMaterial: (body: CreateMaterialInput) => apiPost<RawMaterial>("/api/materials", body),
  recordPurchase: (body: PurchaseRequest) => apiPost<RawMaterial>("/api/materials/purchase", body),

  // Finished products
  products: () => apiGet<FinishedProduct[]>("/api/products"),
  createProduct: (body: CreateProductInput) => apiPost<FinishedProduct>("/api/products", body),

  // Processing
  batches: () => apiGet<ProcessingBatch[]>("/api/processing/batches"),
  createBatch: (body: CreateBatchRequest) => apiPost<ProcessingBatch>("/api/processing/batches", body),
  cancelBatch: (id: number, reason: string) =>
    apiPost<ProcessingBatch>(`/api/processing/batches/${id}/cancel`, { reason }),

  // Invoicing
  invoices: () => apiGet<Invoice[]>("/api/invoices"),
  invoice: (id: number) => apiGet<Invoice>(`/api/invoices/${id}`),
  createInvoice: (body: CreateInvoiceRequest) => apiPost<Invoice>("/api/invoices", body),
  cancelInvoice: (id: number, reason: string) =>
    apiPost<Invoice>(`/api/invoices/${id}/cancel`, { reason }),
  markInvoicePaid: (id: number, body?: RecordPaymentRequest) =>
    apiPost<Invoice>(`/api/invoices/${id}/mark-paid`, body),
  voidPayment: (invoiceId: number, paymentId: number, reason: string) =>
    apiPost<Invoice>(`/api/invoices/${invoiceId}/payments/${paymentId}/void`, { reason }),

  // Payables (supplier PO bills & payments)
  supplierPayables: (supplierId: number) =>
    apiGet<SupplierAgingSummary>(`/api/suppliers/${supplierId}/payables`),
  paySupplier: (supplierId: number, body: RecordSupplierPaymentRequest) =>
    apiPost<{ bill: SupplierAgingSummary["bills"][number]; summary: SupplierAgingSummary }>(
      `/api/suppliers/${supplierId}/payments`,
      body
    ),
  voidSupplierPayment: (supplierId: number, paymentId: number, reason: string) =>
    apiPost<{
      payment: SupplierAgingSummary["bills"][number]["payments"][number];
      summary: SupplierAgingSummary;
    }>(`/api/suppliers/${supplierId}/payments/${paymentId}/void`, { reason }),

  // Inventory adjustments (manual corrections)
  adjustStock: (body: AdjustStockRequest) =>
    apiPost<AdjustStockResponse>("/api/inventory/adjust", body),

  // Traceability
  forwardTrace: (lotNumber: string) =>
    apiGet<ForwardTrace>(`/api/traceability/forward?lotNumber=${encodeURIComponent(lotNumber)}`),
  backwardTrace: (q: string) =>
    apiGet<BackwardTrace>(`/api/traceability/backward?q=${encodeURIComponent(q)}`),

  // Audit ledger
  ledger: (query: string) => apiGet<LedgerQuery>(`/api/audit/ledger?${query}`),

  // AI (arrives later — callers must handle failure gracefully)
  aiQuery: (
    body: { query: string; history?: { role: "user" | "assistant"; content: string }[] },
    signal?: AbortSignal
  ) => apiPost<AiQueryResponse>("/api/ai/query", body, signal),

  // Partners
  partners: () => apiGet<PartnerStats>("/api/partners"),

  // Seed
  seed: () => apiPost<{ ok?: boolean; message?: string }>("/api/seed"),
};
