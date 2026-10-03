# Timber ERP — REST API Documentation

All API endpoints follow RESTful standards, use standard HTTP status codes, and return JSON responses.

---

## Base URL
`/api`

## Response Codes
- `200 OK`: Request succeeded.
- `201 Created`: Resource created successfully.
- `400 Bad Request`: Input validation failed (Zod) or business rule violation (e.g. `InsufficientStockError`).
- `404 Not Found`: Requested entity does not exist (`NotFoundError`).
- `409 Conflict`: Conflict or duplicate operation (e.g. `DuplicateCancellationError`).
- `500 Internal Server Error`: Unhandled server error.

---

## 1. Dashboard & Audit

### `GET /api/dashboard/stats`
Retrieves aggregated business KPIs, real-time stock valuation, low-stock warnings, recent transactions, and monthly sales trends.

**Response (200 OK)**
```json
{
  "kpis": {
    "totalRawStock": 1600.0,
    "totalRawValue": 2570000.0,
    "totalFinishedStock": 350.0,
    "totalFinishedValue": 1120000.0,
    "monthSales": 160000.0,
    "monthGst": 28800.0,
    "wastePercentage": 8.0,
    "cancelledInvoicesCount": 0
  },
  "lowStockItems": [],
  "recentBatches": [],
  "recentInvoices": [],
  "monthlySales": []
}
```

### `GET /api/audit/ledger`
Query the immutable double-entry stock ledger with filtering and pagination.

**Query Parameters:**
- `itemType` (optional): `RAW_MATERIAL` | `FINISHED_PRODUCT`
- `referenceType` (optional): `PURCHASE` | `PROCESSING_INPUT` | `PROCESSING_OUTPUT` | `SALE` | `INVOICE_CANCELLATION` | `ADJUSTMENT`
- `lotNumber` (optional): Filter by exact lot number.
- `limit` (optional): Defaults to 50.
- `offset` (optional): Defaults to 0.

---

## 2. Raw Materials & Suppliers

### `GET /api/materials`
List all raw timber materials and current stock levels.

### `POST /api/materials/purchase`
Record a raw material purchase from a supplier. Automatically updates stock and writes a `PURCHASE` ledger transaction.

**Request Body:**
```json
{
  "materialId": 1,
  "supplierId": 1,
  "quantity": 500,
  "unitRate": 2000,
  "lotNumber": "LOT-RAW-TEAK-002",
  "poNumber": "PO-0004",
  "purchaseDate": "2026-10-01T10:00:00Z"
}
```

### `GET /api/suppliers`
List all registered timber suppliers.

### `POST /api/suppliers`
Register a new supplier.

---

## 3. Processing & Production

### `GET /api/processing/batches`
List all production processing batches.

### `POST /api/processing/batches`
Create a multi-input, multi-output processing conversion batch. Atomically deducts raw material inputs, increments finished/secondary product outputs, records waste/scrap, and logs ledger transactions.

**Request Body (e.g. Batch PB-001):**
```json
{
  "processingDate": "2026-10-01T12:00:00Z",
  "notes": "Teak sawing run 1",
  "inputs": [
    {
      "rawMaterialId": 1,
      "lotNumber": "LOT-RAW-TEAK-001",
      "quantity": 500,
      "unit": "CFT"
    }
  ],
  "outputs": [
    {
      "productId": 1,
      "lotNumber": "LOT-FIN-TEAK-001",
      "outputType": "FINISHED",
      "quantity": 400,
      "unit": "CFT"
    },
    {
      "productId": 4,
      "lotNumber": "LOT-FIN-SECT-001",
      "outputType": "SECONDARY",
      "quantity": 60,
      "unit": "CFT"
    },
    {
      "lotNumber": "WASTE-PB-001",
      "outputType": "WASTE",
      "quantity": 40,
      "unit": "CFT"
    }
  ]
}
```

---

## 4. Finished Products & Sales Invoicing

### `GET /api/products`
List all finished goods and current inventory counts.

### `GET /api/invoices`
List all sales invoices with customer details and line items.

### `POST /api/invoices`
Create and confirm a sales invoice. Atomically validates available stock, calculates GST, deducts finished inventory, associates the sale with the customer, and creates `SALE` ledger entries.

**Request Body (e.g. Invoice INV-0001):**
```json
{
  "customerId": 1,
  "invoiceDate": "2026-10-01T15:00:00Z",
  "items": [
    {
      "productId": 1,
      "lotNumber": "LOT-FIN-TEAK-001",
      "quantity": 50
    }
  ]
}
```

### `POST /api/invoices/[id]/cancel`
Cancels a confirmed invoice. Restores deducted inventory, appends `INVOICE_CANCELLATION` ledger rows (`REV-INV-XXXX`), and records cancellation reason.

**Request Body:**
```json
{
  "reason": "Customer cancellation request"
}
```

**Responses:**
- `200 OK`: Cancelled and stock reversed.
- `409 Conflict`: Invoice was already cancelled (`DuplicateCancellationError`).

---

## 5. Lot & Batch Traceability

### `GET /api/traceability/forward?lotNumber=LOT-RAW-TEAK-001`
Trace from a raw material lot forward to all production batches, output products, and customer invoices.

### `GET /api/traceability/backward?q=INV-0001`
Trace from a customer invoice (or finished product lot) backward to the manufacturing batch, raw material lots consumed, and originating supplier PO.
