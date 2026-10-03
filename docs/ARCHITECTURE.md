# Timber ERP — System Architecture & Engineering Design

This document details the architectural decisions, data models, concurrency control mechanisms, and transactional guarantees implemented in the **Timber Inventory, Processing, Stock Management & Invoicing System**.

---

## 1. System Overview & Technology Stack

The application is engineered as a robust, production-ready enterprise resource planning (ERP) platform for timber processing and trade.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 App Router UI                         │
│  (React 19, Tailwind CSS 4, Radix UI / Shadcn, Framer Motion, Recharts)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API (JSON)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    API Route Handlers (src/app/api)                    │
│          Zod v4 Request Validation & Centralized Error Handler         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Domain Invocations
┌───────────────────────────────────▼────────────────────────────────────┐
│                  Service Domain Layer (src/lib/services)               │
│  ┌──────────────────────┬──────────────────────┬─────────────────────┐ │
│  │    Ledger Service    │  Inventory Service   │  Processing Service │ │
│  ├──────────────────────┼──────────────────────┼─────────────────────┤ │
│  │   Invoice Service    │ Traceability Engine  │  Dashboard Service  │ │
│  └──────────────────────┴──────────────────────┴─────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Prisma Interactive Transactions
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Prisma ORM 6.x + SQLite (WAL Mode)                  │
│       (Fully compatible with PostgreSQL for enterprise clustering)     │
└────────────────────────────────────────────────────────────────────────┘
```

### Core Stack Rationale
- **Next.js 16 (App Router) + TypeScript**: Provides end-to-end type safety, unified frontend and API route execution, and server-side execution of critical financial calculations.
- **Prisma ORM**: Strongly-typed query generation, schema migrations, and structured transaction boundaries.
- **SQLite (WAL mode)**: Zero-friction local deployment and deterministic test execution with foreign keys and ACID transaction guarantees. Seamlessly upgradeable to PostgreSQL via `DATABASE_URL`.
- **Tailwind CSS 4 & Shadcn/UI**: High-density editorial interface optimized for operational workflows, real-time charting, and print-ready tax invoices.

---

## 2. Timber Lifecycle Workflow

The system strictly follows the complete timber supply chain:

```
Supplier Purchase (PO)
       │
       ▼
Raw Material Lot Inventory (e.g. 1,000 CFT Teak)
       │
       ▼
Processing Batch (PB-0001: 500 CFT Teak Consumed)
       ├──► Finished Products (400 CFT Planks) ────► Finished Goods Inventory
       ├──► Secondary Products (60 CFT Pieces)  ───► Secondary Goods Inventory
       └──► Waste / Scrap (40 CFT Waste = 8%)    ───► Waste Metrics (No Stock)
                                                               │
                                                               ▼
                                                      Customer Sale (INV-0001)
                                                               │
                                                       (Atomic Stock Deduction)
                                                               │
                                           ┌───────────────────┴───────────────────┐
                                           ▼                                       ▼
                                     Paid & Settled                     Invoice Cancellation
                                                                        (Full Stock Reversal)
```

---

## 3. Double-Entry Stock Movement Ledger

### Core Invariant
**Inventory stock is NEVER mutated directly without an immutable ledger entry.**

Every physical or logical stock movement creates an immutable `InventoryTransaction` record within the same atomic database transaction:

| Reference Type | Triggered By | Stock Direction | Balance After |
| :--- | :--- | :---: | :--- |
| `PURCHASE` | Raw timber receipt from supplier PO | Stock In $(+)$ | New raw material balance |
| `PROCESSING_INPUT` | Consumption of raw timber into a batch | Stock Out $(-)$ | Decremented raw balance |
| `PROCESSING_OUTPUT` | Production of finished / secondary goods | Stock In $(+)$ | Incremented product balance |
| `SALE` | Confirmation of customer invoice | Stock Out $(-)$ | Decremented product balance |
| `INVOICE_CANCELLATION` | Customer order cancellation | Stock In $(+)$ | Restored product balance |
| `ADJUSTMENT` | Manual physical count reconciliation | $+ / -$ | Adjusted stock balance |

### Ledger Schema
```prisma
model InventoryTransaction {
  id              Int      @id @default(autoincrement())
  timestamp       DateTime @default(now())
  itemType        String   // RAW_MATERIAL | FINISHED_PRODUCT
  itemId          Int
  itemName        String
  referenceType   String   // PURCHASE | PROCESSING_INPUT | PROCESSING_OUTPUT | SALE | INVOICE_CANCELLATION | ADJUSTMENT
  referenceNumber String   // PO-XXXX | PB-XXXX | INV-XXXX | REV-INV-XXXX
  lotNumber       String
  stockIn         Float    @default(0)
  stockOut        Float    @default(0)
  balanceAfter    Float
  unitRate        Float    @default(0)
  supplierId      Int?
  notes           String?
  createdAt       DateTime @default(now())

  @@index([itemType, itemId])
  @@index([referenceType])
  @@index([lotNumber])
  @@index([timestamp])
}
```

---

## 4. Concurrency Control & Race Condition Mitigation

### Problem Statement (PDF Section 11)
Available `Finished Teak Plank` stock is **100 CFT**. User A requests **70 CFT** and User B requests **60 CFT** nearly simultaneously (Total requested = 130 CFT). The system must guarantee that stock can never drop below zero (preventing $-30\text{ CFT}$).

### Solution: Atomic Conditional Updates Inside ACID Transactions
The system utilizes conditional SQL updates that evaluate availability at the database engine level rather than relying on stale application-memory reads:

```typescript
// src/lib/services/inventory.ts
export async function deductStock(
  tx: Prisma.TransactionClient,
  model: StockModel,
  id: number,
  qty: number
): Promise<RawMaterial | FinishedProduct> {
  // Executes: UPDATE FinishedProduct SET currentStock = currentStock - :qty
  //           WHERE id = :id AND currentStock >= :qty
  const result = await tx.finishedProduct.updateMany({
    where: { id, currentStock: { gte: qty } },
    data: { currentStock: { decrement: qty } },
  });

  // If result.count === 0, another concurrent transaction claimed the stock first
  if (result.count === 0) {
    const item = await tx.finishedProduct.findUnique({ where: { id } });
    if (!item) throw new NotFoundError(`Product #${id} not found.`);
    throw new InsufficientStockError(
      `Insufficient stock for ${item.name}. Available: ${item.currentStock}, Requested: ${qty}`
    );
  }

  return tx.finishedProduct.findUniqueOrThrow({ where: { id } });
}
```

### Transaction Rollback Guarantee
Both the stock decrement and the ledger insertion occur inside `db.$transaction(async (tx) => { ... })`. If an error occurs on any line item:
1. The entire database transaction is rolled back immediately.
2. No partial stock deductions persist.
3. No orphan ledger rows remain.

---

## 5. Relational Lot Traceability Engine

Traceability is modeled relationally via persistent foreign keys and indexed lot numbers across the entire lifecycle:

```
Supplier (id, gstNumber)
   │
   ▼
InventoryTransaction (ref: PO-0001, lotNumber: LOT-RAW-TEAK-001)
   │
   ▼
BatchInputItem (batchId: PB-0001, lotNumber: LOT-RAW-TEAK-001)
   │
ProcessingBatch (batchNumber: PB-0001)
   │
   ▼
BatchOutputItem (batchId: PB-0001, lotNumber: LOT-FIN-TEAK-001)
   │
   ▼
InvoiceItem (invoiceId: INV-0001, lotNumber: LOT-FIN-TEAK-001)
   │
   ▼
Customer (id, companyName, gstNumber)
```

### Forward Traceability (`/api/traceability/forward?lotNumber=LOT-RAW-TEAK-001`)
Answers: **"Given this incoming raw lot, which processing batches used it, what products were produced, and which customer invoices received them?"**

### Backward Traceability (`/api/traceability/backward?q=INV-0001` or `q=LOT-FIN-TEAK-001`)
Answers: **"Given this customer invoice or finished lot, which production batch manufactured it, which raw material lots were consumed, and who was the originating supplier with their PO reference?"**

---

## 6. Invoice Lifecycle & Cancellation Reversal

1. **Creation & Confirmation**:
   - Computes line tax: $\text{Tax} = \text{round}_2\left(\frac{\text{Qty} \times \text{Unit Price} \times \text{GST \%}}{100}\right)$
   - Computes line total: $\text{Line Total} = (\text{Qty} \times \text{Unit Price}) + \text{Tax}$
   - Atomically decrements finished stock.
   - Logs `SALE` ledger entries.
   - Status transitions directly to `CONFIRMED`.

2. **Cancellation & Stock Reversal**:
   - Verifies invoice exists and is not already `CANCELLED` (duplicate cancellation throws `409 Conflict`).
   - Restores stock for all line items atomically using `addStock(tx, ...)`.
   - Appends audit ledger entries with `referenceType = "INVOICE_CANCELLATION"` and `referenceNumber = "REV-<invoiceNumber>"`.
   - Stamped with `cancelledAt = NOW()` and `cancellationReason`.
   - Historical invoice remains permanently visible in the audit trail.
