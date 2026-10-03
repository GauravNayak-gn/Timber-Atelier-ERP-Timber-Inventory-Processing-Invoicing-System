# Timber Atelier ERP — Timber Inventory, Processing & Invoicing System

A complete enterprise-grade web application for timber purchasing, sawmill conversion processing, stock ledger management, sales invoicing, and end-to-end batch/lot traceability.

Designed and built to satisfy all requirements of the **Software Engineering Assessment (Timber Inventory, Processing & Invoicing Management System)**.

---

## Table of Contents
- [1. Executive Summary & Key Highlights](#1-executive-summary--key-highlights)
- [2. Technology Choices & Architecture](#2-technology-choices--architecture)
- [3. Getting Started (Setup & Run Instructions)](#3-getting-started-setup--run-instructions)
- [4. Automated Testing (14/14 Scenarios Covered)](#4-automated-testing-1414-scenarios-covered)
- [5. Concurrency & Inventory Consistency Design](#5-concurrency--inventory-consistency-design)
- [6. Batch & Lot Traceability Engine](#6-batch--lot-traceability-engine)
- [7. Deliverables & Evaluation Criteria Matrix](#7-deliverables--evaluation-criteria-matrix)
- [8. Docker & Containerization](#8-docker--containerization)
- [9. REST API Reference](#9-rest-api-reference)

---

## 1. Executive Summary & Key Highlights

- **Complete Timber Lifecycle**: Models the end-to-end journey: `Supplier PO` $\to$ `Raw Material Lot` $\to$ `Sawmill Conversion Batch` $\to$ `Finished & Secondary Goods + Scrap` $\to$ `Customer Invoice` $\to$ `Cancellation / Reversal` $\to$ `Immutable Audit Ledger`.
- **Append-Only Double-Entry Ledger**: Stock is **never** mutated directly without an immutable `InventoryTransaction` record capturing running balance, reference numbers, unit rates, and lot numbers.
- **Race-Condition & Concurrency Safe**: Prevents negative stock under simultaneous multi-user operations via database-level conditional atomic updates (`UPDATE ... WHERE currentStock >= qty`) inside ACID transactions.
- **Bi-Directional Relational Traceability**:
  - *Forward Traceability*: Originating Supplier $\to$ Raw Lot $\to$ Processing Batches $\to$ Finished Goods Lots $\to$ Customer Invoices.
  - *Backward Traceability*: Customer Invoice $\to$ Sold Output Lots $\to$ Processing Run $\to$ Raw Material Lots Consumed $\to$ Supplier Purchase Order & GST details.
- **Printable Tax Invoices & Reports**: Clean, professional print views with `@media print` support for tax invoices, batch processing certificates, and supplier statements.
- **100% Automated Test Coverage**: Vitest suite thoroughly exercising all 14 mandatory business scenarios from Section 17 of the assessment.

---

## 2. Technology Choices & Architecture

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | **Next.js 16 (App Router) + React 19** | Zero-bloat modern React architecture, unified type system, SSR/streaming performance. |
| **Styling & Components**| **Tailwind CSS 4 + Shadcn/UI (Radix)** | High-density enterprise UI, responsive layouts, accessible dialogs, and native dark mode. |
| **Backend & Routing**  | **Next.js Route Handlers (`src/app/api`)**| Clean REST endpoints with strict separation between routing, validation, and domain logic. |
| **Validation**         | **Zod v4** | Runtime schema enforcement for API payloads, numeric sanitization, and positive stock guards. |
| **ORM & Database**     | **Prisma ORM 6.x + SQLite (WAL Mode)** | Strong typing, relational mapping, and deterministic local execution without external DB dependencies. Fully compatible with PostgreSQL for distributed multi-tenant environments. |
| **Testing**            | **Vitest** | Blazing-fast native ESM test runner executing database integration tests with full isolation. |

For deep architectural explanations and sequence diagrams, refer to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 3. Getting Started (Setup & Run Instructions)

### Prerequisites
- **Node.js** v20+ or **Bun** v1.2+
- Git

### Installation & Local Run

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd workspace-19a0eeba-bd9c-4d2e-bed1-949cc53ae4bb
   ```

2. **Install dependencies:**
   ```bash
   bun install
   # or: npm install
   ```

3. **Verify Environment Variables:**
   The repository includes a ready-to-use `.env` configured for portable SQLite execution:
   ```env
   DATABASE_URL="file:../db/custom.db"
   ```

4. **Generate Prisma Client & Apply Migrations:**
   ```bash
   bun run db:generate
   bun run db:migrate
   ```

5. **Seed Assessment Sample Data:**
   Populates suppliers (Greenply, Malabar), raw materials (Teak, Pine, Plywood), Batch PB-001, and Invoice INV-0001:
   ```bash
   bun run seed
   # or: npm run seed
   ```

6. **Start the Development Server:**
   ```bash
   bun run dev
   # or: npm run dev
   ```
   Open **http://localhost:3000** in your browser to access the Timber Atelier ERP dashboard.

---

## 4. Automated Testing (14/14 Scenarios Covered)

Run the test suite:
```bash
bun test
# or: npm test
```

### Coverage of Section 17 Scenarios
The automated test suite in [`tests/business-scenarios.test.ts`](tests/business-scenarios.test.ts) comprehensively validates all 14 required business scenarios:

1. **Adding raw-material stock**: Validates receipt of raw timber, stock increment, and immutable `PURCHASE` ledger row.
2. **Processing material**: Validates multi-input / multi-output conversion, output stock additions, and waste percentage calculation.
3. **Insufficient raw-material stock**: Rejects processing runs when requested raw timber exceeds available stock.
4. **Finished-product creation**: Validates catalog registration with SKU uniqueness, selling prices, and GST rates.
5. **Invoice calculation and confirmation**: Validates subtotal, line-item GST math, and grand totals to 2 decimal places.
6. **Finished-stock deduction**: Validates stock decrement and `SALE` ledger logging upon invoice confirmation.
7. **Insufficient finished stock**: Rejects invoice confirmation when order quantity exceeds available stock.
8. **Invoice cancellation**: Validates invoice status transition to `CANCELLED` with audit metadata and reason tracking.
9. **Stock reversal**: Validates automatic restoration of deducted stock and `INVOICE_CANCELLATION` (`REV-INV-XXXX`) ledger entries.
10. **Duplicate cancellation**: Validates idempotency, rejecting repeated cancellations with `409 Conflict`.
11. **Concurrent stock operations**: Simulates simultaneous race conditions (User A requests 70 CFT, User B requests 60 CFT with 100 CFT available) and guarantees stock never drops below zero.
12. **Batch traceability**: Validates full forward and backward lot lineage across the supply chain.
13. **Invalid input**: Validates Zod rejection of negative quantities, zero quantities, and invalid date formats.
14. **Transaction rollback / failure scenarios**: Validates that multi-item invoice failures roll back all stock changes atomically without leaving orphan records.

---

## 5. Concurrency & Inventory Consistency Design

### The Challenge
When multiple users confirm invoices or process batches simultaneously, uncoordinated reads and writes can lead to overselling or negative inventory.

### Our Solution: Engine-Level Atomic Conditional Updates
Instead of checking stock in application memory and issuing a blind update, the system issues atomic conditional updates directly at the database engine level:

```sql
UPDATE FinishedProduct
SET currentStock = currentStock - :requestedQty
WHERE id = :productId AND currentStock >= :requestedQty;
```

If another transaction consumed the stock in the meantime, the database matches **0 rows**, triggering an immediate `InsufficientStockError` and rolling back the transaction.

```typescript
// src/lib/services/inventory.ts
const result = await tx.finishedProduct.updateMany({
  where: { id, currentStock: { gte: qty } },
  data: { currentStock: { decrement: qty } },
});
if (result.count === 0) {
  throw new InsufficientStockError(`Insufficient stock for product #${id}`);
}
```

This guarantees:
- **Zero negative stock**: Inventory can never drop below 0.
- **ACID isolation**: Ledger entries and stock adjustments always commit or rollback together.
- **High throughput**: Non-conflicting products process concurrently without table-level locking.

---

## 6. Batch & Lot Traceability Engine

Traceability is built directly into the relational data model through foreign keys and indexed lot strings:

```
[Supplier PO: PO-0001]
       │
       ▼
[Raw Material Lot: LOT-RAW-TEAK-001]
       │
       ▼
[Processing Batch: PB-0001] (500 CFT Teak consumed)
       │
       ├─► [Finished Lot: LOT-FIN-TEAK-001] (400 CFT Planks) ─► [Invoice: INV-0001] ─► ABC Furniture Pvt Ltd
       ├─► [Secondary Lot: LOT-FIN-SECT-001] (60 CFT Pieces)
       └─► [Waste: WASTE-PB-0001-01] (40 CFT Scrap = 8.0%)
```

- **Forward Traceability API**: `GET /api/traceability/forward?lotNumber=LOT-RAW-TEAK-001`
- **Backward Traceability API**: `GET /api/traceability/backward?q=INV-0001`

---

## 7. Deliverables & Evaluation Criteria Matrix

| Deliverable (Section 18) | Location | Description |
| :--- | :--- | :--- |
| **1. Complete source code** | `src/`, `prisma/` | Clean Next.js 16 + TypeScript enterprise code. |
| **2. Frontend application** | `src/components/timber/` | Responsive UI with dashboard, stock dialogs, and trace graphs. |
| **3. Backend/API** | `src/app/api/` | 13+ RESTful route handlers with error mapping. |
| **4. Database schema & migrations** | `prisma/migrations/` | Relational schema and initial SQL migration DDL. |
| **5. Sample/seed data** | `prisma/seed.ts` | Populates Teak, Pine, Plywood, PB-001, and INV-0001. |
| **6. Automated tests** | `tests/` | 16 tests covering all 14 assessment scenarios. |
| **7. README** | `README.md` | Master setup, architecture, and run instructions. |
| **8. API documentation** | `docs/API_DOCUMENTATION.md` | Complete REST API schemas and payloads. |
| **9. Architecture explanation** | `docs/ARCHITECTURE.md` | Concurrency, ledger design, and sequence diagrams. |

---

## 8. Docker & Containerization

A complete Docker setup is included for isolated, reproducible deployments:

```bash
# Build and run using Docker Compose
docker compose up --build
```
The application will be available at **http://localhost:3000** with the database volume persisted.

---

## 9. REST API Reference

For detailed request and response payloads, status codes, and query parameters, see [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md).

---

## License
MIT. Built for the Timber Software Engineering Assessment.
