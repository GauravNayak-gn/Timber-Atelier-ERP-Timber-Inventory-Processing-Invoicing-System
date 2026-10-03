import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import {
  createAndConfirmInvoice,
  cancelInvoice,
  getInvoice,
} from "@/lib/services/invoice";
import {
  createProcessingBatch,
  cancelProcessingBatch,
} from "@/lib/services/processing";
import { deductStock, addStock } from "@/lib/services/inventory";
import { recordMovement } from "@/lib/services/ledger";
import { traceForward, traceBackward } from "@/lib/services/traceability";
import {
  InsufficientStockError,
  DuplicateCancellationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api-error";
import { z } from "zod";
import { positiveQty, nonNegative, isoDate, reqStr } from "@/lib/validation";

describe("Timber Inventory, Processing & Invoicing Assessment Test Suite", () => {
  // Always reset to a known baseline (sample data from PDF) before tests
  beforeEach(async () => {
    await seedDatabase();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Adding raw-material stock
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 1: Adding raw-material stock", () => {
    it("should increase stock and record an immutable PURCHASE ledger transaction", async () => {
      const teak = await db.rawMaterial.findFirstOrThrow({
        where: { skuCode: "RM-TEAK-001" },
      });
      const supplier = await db.supplier.findFirstOrThrow();
      const initialStock = teak.currentStock; // 500 after seed batch PB-001
      const receiveQty = 300;
      const unitRate = 2100;
      const poNumber = "PO-TEST-001";
      const lotNumber = "LOT-RAW-TEAK-TEST";

      const updated = await db.$transaction(async (tx) => {
        const item = await addStock(tx, "rawMaterial", teak.id, receiveQty);
        await recordMovement(tx, {
          itemType: "RAW_MATERIAL",
          itemId: teak.id,
          itemName: teak.name,
          referenceType: "PURCHASE",
          referenceNumber: poNumber,
          lotNumber,
          stockIn: receiveQty,
          balanceAfter: item.currentStock,
          unitRate,
          supplierId: supplier.id,
          notes: `Purchase of ${receiveQty} CFT from ${supplier.companyName}`,
        });
        return item;
      });

      expect(updated.currentStock).toBe(initialStock + receiveQty);

      // Verify immutable audit ledger entry
      const txRow = await db.inventoryTransaction.findFirst({
        where: { referenceNumber: poNumber, lotNumber },
      });
      expect(txRow).toBeDefined();
      expect(txRow?.referenceType).toBe("PURCHASE");
      expect(txRow?.stockIn).toBe(receiveQty);
      expect(txRow?.stockOut).toBe(0);
      expect(txRow?.balanceAfter).toBe(initialStock + receiveQty);
      expect(txRow?.unitRate).toBe(unitRate);
      expect(txRow?.supplierId).toBe(supplier.id);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Processing material
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 2: Processing material", () => {
    it("should deduct raw input, create finished/secondary outputs, and log waste %", async () => {
      const teak = await db.rawMaterial.findFirstOrThrow({
        where: { skuCode: "RM-TEAK-001" },
      });
      const plank = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-P-001" },
      });
      const sections = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-S-001" },
      });

      const inputQty = 200;
      const outputPlankQty = 150;
      const outputSectionsQty = 30;
      const wasteQty = 20; // 20 / 200 = 10% waste

      const initialTeak = teak.currentStock;
      const initialPlank = plank.currentStock;
      const initialSections = sections.currentStock;

      const batch = await createProcessingBatch({
        processingDate: new Date().toISOString(),
        notes: "Test conversion run",
        inputs: [
          {
            rawMaterialId: teak.id,
            lotNumber: "LOT-RAW-TEAK-001",
            quantity: inputQty,
            unit: "CFT",
          },
        ],
        outputs: [
          {
            productId: plank.id,
            lotNumber: "LOT-FIN-TEAK-BATCH2",
            outputType: "FINISHED",
            quantity: outputPlankQty,
            unit: "CFT",
          },
          {
            productId: sections.id,
            lotNumber: "LOT-FIN-SECT-BATCH2",
            outputType: "SECONDARY",
            quantity: outputSectionsQty,
            unit: "CFT",
          },
          {
            outputType: "WASTE",
            lotNumber: "WASTE-BATCH2-01",
            quantity: wasteQty,
            unit: "CFT",
          },
        ],
      });

      expect(batch.status).toBe("COMPLETED");
      expect(batch.totalInputQty).toBe(200);
      expect(batch.totalOutputQty).toBe(180);
      expect(batch.totalWasteQty).toBe(20);
      expect(batch.wastePercentage).toBe(10); // (20 / 200) * 100

      // Verify stock changes
      const updatedTeak = await db.rawMaterial.findUniqueOrThrow({ where: { id: teak.id } });
      const updatedPlank = await db.finishedProduct.findUniqueOrThrow({ where: { id: plank.id } });
      const updatedSections = await db.finishedProduct.findUniqueOrThrow({ where: { id: sections.id } });

      expect(updatedTeak.currentStock).toBe(initialTeak - inputQty);
      expect(updatedPlank.currentStock).toBe(initialPlank + outputPlankQty);
      expect(updatedSections.currentStock).toBe(initialSections + outputSectionsQty);

      // Verify ledger entries for processing input and outputs
      const inputTx = await db.inventoryTransaction.findFirst({
        where: { referenceNumber: batch.batchNumber, referenceType: "PROCESSING_INPUT" },
      });
      expect(inputTx?.stockOut).toBe(inputQty);

      const outputTx = await db.inventoryTransaction.findMany({
        where: { referenceNumber: batch.batchNumber, referenceType: "PROCESSING_OUTPUT" },
      });
      expect(outputTx.length).toBe(2); // Planks & Sections (Waste does NOT create product stock)
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Insufficient raw-material stock
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 3: Insufficient raw-material stock", () => {
    it("should reject processing when requested quantity exceeds available stock", async () => {
      const teak = await db.rawMaterial.findFirstOrThrow({
        where: { skuCode: "RM-TEAK-001" },
      });
      const plank = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-P-001" },
      });

      const excessiveQty = teak.currentStock + 500; // request more than available

      await expect(
        createProcessingBatch({
          inputs: [
            {
              rawMaterialId: teak.id,
              lotNumber: "LOT-RAW-TEAK-001",
              quantity: excessiveQty,
              unit: "CFT",
            },
          ],
          outputs: [
            {
              productId: plank.id,
              lotNumber: "LOT-FIN-FAIL",
              outputType: "FINISHED",
              quantity: 100,
              unit: "CFT",
            },
          ],
        })
      ).rejects.toThrow(InsufficientStockError);

      // Verify stock untouched
      const teakAfter = await db.rawMaterial.findUniqueOrThrow({ where: { id: teak.id } });
      expect(teakAfter.currentStock).toBe(teak.currentStock);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Finished-product creation
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 4: Finished-product creation", () => {
    it("should successfully register a finished product with pricing and tax rate", async () => {
      const product = await db.finishedProduct.create({
        data: {
          name: "Cedar Decking Board",
          skuCode: "FP-CEDAR-001",
          category: "Decking",
          unit: "CFT",
          sellingPrice: 4200,
          taxRatePercent: 18,
          currentStock: 0,
          reorderThreshold: 25,
        },
      });

      expect(product.id).toBeDefined();
      expect(product.currentStock).toBe(0);
      expect(product.sellingPrice).toBe(4200);
      expect(product.taxRatePercent).toBe(18);

      // Unique SKU constraint check
      await expect(
        db.finishedProduct.create({
          data: {
            name: "Duplicate SKU Board",
            skuCode: "FP-CEDAR-001",
            category: "Decking",
            unit: "CFT",
            sellingPrice: 4200,
            taxRatePercent: 18,
          },
        })
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Invoice calculation and confirmation
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 5: Invoice calculation and confirmation", () => {
    it("should calculate line tax, subtotals, and grand totals accurately", async () => {
      const customer = await db.customer.findFirstOrThrow();
      const plank = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-P-001" },
      });

      // Price: ₹3,200/CFT, Tax: 18%
      // 50 CFT -> Subtotal: 160,000, Tax: 28,800, Total: 188,800
      const invoice = await createAndConfirmInvoice({
        customerId: customer.id,
        items: [
          {
            productId: plank.id,
            lotNumber: "LOT-FIN-TEAK-001",
            quantity: 50,
          },
        ],
      });

      expect(invoice.status).toBe("CONFIRMED");
      expect(invoice.subtotal).toBe(160000);
      expect(invoice.taxTotal).toBe(28800);
      expect(invoice.grandTotal).toBe(188800);
      expect(invoice.items.length).toBe(1);
      expect(invoice.items[0].lineTotal).toBe(188800);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Finished-stock deduction
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 6: Finished-stock deduction", () => {
    it("should atomically deduct finished stock and log SALE ledger rows", async () => {
      const customer = await db.customer.findFirstOrThrow();
      const plank = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-P-001" },
      });
      const initialStock = plank.currentStock; // 350 after seed INV-0001
      const saleQty = 40;

      const invoice = await createAndConfirmInvoice({
        customerId: customer.id,
        items: [
          {
            productId: plank.id,
            lotNumber: "LOT-FIN-TEAK-001",
            quantity: saleQty,
          },
        ],
      });

      const productAfter = await db.finishedProduct.findUniqueOrThrow({
        where: { id: plank.id },
      });
      expect(productAfter.currentStock).toBe(initialStock - saleQty);

      // Verify SALE ledger entry
      const saleTx = await db.inventoryTransaction.findFirst({
        where: { referenceNumber: invoice.invoiceNumber, referenceType: "SALE" },
      });
      expect(saleTx).toBeDefined();
      expect(saleTx?.stockOut).toBe(saleQty);
      expect(saleTx?.balanceAfter).toBe(initialStock - saleQty);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. Insufficient finished stock
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 7: Insufficient finished stock", () => {
    it("should prevent invoice creation if sale quantity exceeds available stock", async () => {
      const customer = await db.customer.findFirstOrThrow();
      const plank = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-P-001" },
      });

      const excessiveQty = plank.currentStock + 1000;

      await expect(
        createAndConfirmInvoice({
          customerId: customer.id,
          items: [
            {
              productId: plank.id,
              lotNumber: "LOT-FIN-TEAK-001",
              quantity: excessiveQty,
            },
          ],
        })
      ).rejects.toThrow(InsufficientStockError);

      // Verify stock remained unchanged
      const plankAfter = await db.finishedProduct.findUniqueOrThrow({
        where: { id: plank.id },
      });
      expect(plankAfter.currentStock).toBe(plank.currentStock);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Invoice cancellation
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 8: Invoice cancellation", () => {
    it("should mark invoice CANCELLED and store cancellation metadata", async () => {
      const invoice = await db.invoice.findFirstOrThrow({
        where: { invoiceNumber: "INV-0001" },
      });

      const cancelled = await cancelInvoice(invoice.id, "Customer returned goods");

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancellationReason).toBe("Customer returned goods");
      expect(cancelled.cancelledAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Stock reversal
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 9: Stock reversal", () => {
    it("should restore deducted stock and log INVOICE_CANCELLATION ledger entry", async () => {
      const invoice = await db.invoice.findFirstOrThrow({
        where: { invoiceNumber: "INV-0001" },
        include: { items: true },
      });
      const item = invoice.items[0];
      const productBefore = await db.finishedProduct.findUniqueOrThrow({
        where: { id: item.productId },
      });

      await cancelInvoice(invoice.id, "Order cancellation test");

      const productAfter = await db.finishedProduct.findUniqueOrThrow({
        where: { id: item.productId },
      });
      expect(productAfter.currentStock).toBe(productBefore.currentStock + item.quantity);

      // Verify reversal ledger row
      const revTx = await db.inventoryTransaction.findFirst({
        where: {
          referenceNumber: `REV-${invoice.invoiceNumber}`,
          referenceType: "INVOICE_CANCELLATION",
        },
      });
      expect(revTx).toBeDefined();
      expect(revTx?.stockIn).toBe(item.quantity);
      expect(revTx?.balanceAfter).toBe(productAfter.currentStock);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Duplicate cancellation
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 10: Duplicate cancellation", () => {
    it("should throw DuplicateCancellationError (HTTP 409) if cancelled again", async () => {
      const invoice = await db.invoice.findFirstOrThrow({
        where: { invoiceNumber: "INV-0001" },
      });

      // First cancel succeeds
      await cancelInvoice(invoice.id, "First cancel");

      // Second cancel must fail
      await expect(cancelInvoice(invoice.id, "Second cancel")).rejects.toThrow(
        DuplicateCancellationError
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 11. Concurrent stock operations
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 11: Concurrent stock operations", () => {
    it("should prevent race conditions and ensure stock never becomes negative", async () => {
      // Create an isolated product with 100 CFT available stock
      const isolatedProduct = await db.finishedProduct.create({
        data: {
          name: "Concurrent Test Timber",
          skuCode: `FP-RACE-${Date.now()}`,
          sellingPrice: 3000,
          currentStock: 100, // 100 CFT available
        },
      });

      // User A requests 70 CFT, User B requests 60 CFT simultaneously (Total requested: 130 > 100)
      const opA = db.$transaction(async (tx) => {
        return deductStock(tx, "finishedProduct", isolatedProduct.id, 70);
      });
      const opB = db.$transaction(async (tx) => {
        return deductStock(tx, "finishedProduct", isolatedProduct.id, 60);
      });

      const results = await Promise.allSettled([opA, opB]);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      // Exactly ONE request must succeed, and ONE must fail
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Verify the failure was an InsufficientStockError
      const rejection = failures[0] as PromiseRejectedResult;
      expect(rejection.reason instanceof InsufficientStockError).toBe(true);

      // Verify stock in database is non-negative and equals the remainder (either 30 or 40)
      const finalProduct = await db.finishedProduct.findUniqueOrThrow({
        where: { id: isolatedProduct.id },
      });
      expect(finalProduct.currentStock).toBeGreaterThanOrEqual(0);
      expect([30, 40]).toContain(finalProduct.currentStock);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Batch & lot traceability
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 12: Batch & lot traceability", () => {
    it("should provide end-to-end forward traceability from raw lot to customer invoice", async () => {
      const trace = await traceForward("LOT-RAW-TEAK-001");

      expect(trace.rootLot).toBe("LOT-RAW-TEAK-001");
      expect(trace.material?.name).toBe("Teak Timber");
      expect(trace.purchase?.poNumber).toBe("PO-0001");
      expect(trace.purchase?.supplierName).toBe("Greenply Timber Ltd");

      expect(trace.batches.length).toBeGreaterThan(0);
      const pb001 = trace.batches.find((b) => b.batchNumber === "PB-0001");
      expect(pb001).toBeDefined();
      expect(pb001?.consumedQty).toBe(500);

      // Verify it traces through to output lots and customer invoices
      const hasInvoice = pb001?.invoices.some((inv) => inv.invoiceNumber === "INV-0001");
      expect(hasInvoice).toBe(true);
    });

    it("should provide backward traceability from customer invoice to originating raw lot & PO", async () => {
      const trace = await traceBackward("INV-0001");

      expect(trace.root).toBe("INV-0001");
      expect(trace.invoice).toBeDefined();
      expect(trace.invoice?.customerName).toBe("ABC Furniture Pvt Ltd");

      expect(trace.lots.length).toBeGreaterThan(0);
      const line = trace.lots[0];
      expect(line.lotNumber).toBe("LOT-FIN-TEAK-001");
      expect(line.batch?.batchNumber).toBe("PB-0001");

      const rawInput = line.rawInputs.find((r) => r.lotNumber === "LOT-RAW-TEAK-001");
      expect(rawInput).toBeDefined();
      expect(rawInput?.materialName).toBe("Teak Timber");
      expect(line.purchases.some((p) => p.poNumber === "PO-0001")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 13. Invalid input validation
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 13: Invalid input validation", () => {
    it("should reject negative or zero quantities with Zod validation", () => {
      const qtySchema = positiveQty("quantity");

      expect(() => qtySchema.parse(-10)).toThrow();
      expect(() => qtySchema.parse(0)).toThrow();
      expect(qtySchema.parse(15.5)).toBe(15.5);
    });

    it("should reject empty strings or invalid ISO dates", () => {
      const nameSchema = reqStr("name");
      expect(() => nameSchema.parse("")).toThrow();
      expect(() => nameSchema.parse("   ")).toThrow();
      expect(nameSchema.parse("Teak")).toBe("Teak");

      expect(() => isoDate.parse("not-a-date")).toThrow();
      expect(isoDate.parse("2026-10-01T10:00:00Z")).toBe("2026-10-01T10:00:00Z");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 14. Transaction rollback / failure scenarios
  // ─────────────────────────────────────────────────────────────
  describe("Scenario 14: Transaction rollback / failure scenarios", () => {
    it("should roll back all operations if any line item in a multi-item invoice fails", async () => {
      const customer = await db.customer.findFirstOrThrow();
      const plank = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-P-001" },
      });
      const beam = await db.finishedProduct.findFirstOrThrow({
        where: { skuCode: "FP-TEAK-B-001" },
      });

      const initialPlankStock = plank.currentStock;
      const initialBeamStock = beam.currentStock; // 0 in seeded data

      // Line 1 has sufficient stock (10 CFT of plank), but Line 2 has insufficient stock (50 CFT of beam when 0 available)
      await expect(
        createAndConfirmInvoice({
          customerId: customer.id,
          items: [
            { productId: plank.id, lotNumber: "LOT-FIN-TEAK-001", quantity: 10 },
            { productId: beam.id, lotNumber: "LOT-FIN-BEAM-001", quantity: 50 },
          ],
        })
      ).rejects.toThrow(InsufficientStockError);

      // Verify entire transaction rolled back: plank stock was NOT deducted!
      const plankAfter = await db.finishedProduct.findUniqueOrThrow({ where: { id: plank.id } });
      const beamAfter = await db.finishedProduct.findUniqueOrThrow({ where: { id: beam.id } });

      expect(plankAfter.currentStock).toBe(initialPlankStock);
      expect(beamAfter.currentStock).toBe(initialBeamStock);

      // Verify no orphan invoice was created
      const invoices = await db.invoice.findMany({
        where: { customerId: customer.id, grandTotal: { gt: 0 } },
      });
      // Only the seed invoice should exist
      expect(invoices.length).toBe(1);
    });
  });
});
