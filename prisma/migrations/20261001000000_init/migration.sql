-- CreateTable
CREATE TABLE "Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyName" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "gstNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyName" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "gstNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RawMaterial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Timber',
    "unit" TEXT NOT NULL DEFAULT 'CFT',
    "currentStock" REAL NOT NULL DEFAULT 0,
    "unitPurchaseRate" REAL NOT NULL DEFAULT 0,
    "reorderThreshold" REAL NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FinishedProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Plank',
    "unit" TEXT NOT NULL DEFAULT 'CFT',
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "taxRatePercent" REAL NOT NULL DEFAULT 18,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "reorderThreshold" REAL NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemType" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "stockIn" REAL NOT NULL DEFAULT 0,
    "stockOut" REAL NOT NULL DEFAULT 0,
    "balanceAfter" REAL NOT NULL,
    "unitRate" REAL NOT NULL DEFAULT 0,
    "supplierId" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProcessingBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchNumber" TEXT NOT NULL,
    "processingDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "wastePercentage" REAL NOT NULL DEFAULT 0,
    "totalInputQty" REAL NOT NULL DEFAULT 0,
    "totalOutputQty" REAL NOT NULL DEFAULT 0,
    "totalWasteQty" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "cancellationReason" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BatchInputItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "quantityConsumed" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'CFT',
    CONSTRAINT "BatchInputItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchInputItem_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BatchOutputItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "productId" INTEGER,
    "lotNumber" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "quantityProduced" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'CFT',
    CONSTRAINT "BatchOutputItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchOutputItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "FinishedProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "invoiceDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "taxTotal" REAL NOT NULL DEFAULT 0,
    "grandTotal" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "paidAt" DATETIME,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "paymentNotes" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "notes" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitPrice" REAL NOT NULL,
    "taxRatePercent" REAL NOT NULL,
    "taxAmount" REAL NOT NULL,
    "lineTotal" REAL NOT NULL,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "FinishedProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "supplierId" INTEGER NOT NULL,
    "poNumber" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "notes" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyName_key" ON "Supplier"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyName_key" ON "Customer"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_skuCode_key" ON "RawMaterial"("skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedProduct_skuCode_key" ON "FinishedProduct"("skuCode");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemType_itemId_idx" ON "InventoryTransaction"("itemType", "itemId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_referenceType_idx" ON "InventoryTransaction"("referenceType");

-- CreateIndex
CREATE INDEX "InventoryTransaction_lotNumber_idx" ON "InventoryTransaction"("lotNumber");

-- CreateIndex
CREATE INDEX "InventoryTransaction_timestamp_idx" ON "InventoryTransaction"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingBatch_batchNumber_key" ON "ProcessingBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "BatchInputItem_lotNumber_idx" ON "BatchInputItem"("lotNumber");

-- CreateIndex
CREATE INDEX "BatchInputItem_batchId_idx" ON "BatchInputItem"("batchId");

-- CreateIndex
CREATE INDEX "BatchOutputItem_lotNumber_idx" ON "BatchOutputItem"("lotNumber");

-- CreateIndex
CREATE INDEX "BatchOutputItem_batchId_idx" ON "BatchOutputItem"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_lotNumber_idx" ON "InvoiceItem"("lotNumber");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPayment_poNumber_idx" ON "SupplierPayment"("poNumber");
