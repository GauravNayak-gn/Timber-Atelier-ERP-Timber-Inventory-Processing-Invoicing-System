import { db } from "@/lib/db";

/**
 * Idempotent seeder — wipes and repopulates the database with the
 * assessment sample data:
 *  - 2 suppliers, 1 customer
 *  - 3 raw materials with opening stock via PO ledger entries
 *  - 4 finished products
 *  - Processing batch PB-001 (500 CFT Teak -> 400 Plank + 60 Sections + 40 Waste)
 *  - Confirmed invoice INV-0001 (50 CFT Finished Teak Plank, LOT-FIN-TEAK-001)
 */
export async function seedDatabase() {
  const existing = await db.supplier.findFirst();
  if (existing) {
    // Wipe in FK-safe order — payment ledgers first (they reference
    // Invoice/Supplier rows that have no onDelete cascade to them).
    await db.supplierPayment.deleteMany();
    await db.invoicePayment.deleteMany();
    await db.invoiceItem.deleteMany();
    await db.invoice.deleteMany();
    await db.batchOutputItem.deleteMany();
    await db.batchInputItem.deleteMany();
    await db.processingBatch.deleteMany();
    await db.inventoryTransaction.deleteMany();
    await db.finishedProduct.deleteMany();
    await db.rawMaterial.deleteMany();
    await db.customer.deleteMany();
    await db.supplier.deleteMany();
  }

  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);
  // Keep a date inside the current calendar month (so monthly KPIs have data)
  const currentMonthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1);
  const withinThisMonth = (d: Date) => (d < currentMonthStart ? currentMonthStart : d);

  // ── Suppliers ──
  const greenply = await db.supplier.create({
    data: {
      companyName: "Greenply Timber Ltd",
      contactPerson: "Rajesh Menon",
      phone: "+91 98200 11223",
      email: "sales@greenplytimber.in",
      address: "Plot 14, MIDC Industrial Area, Nagpur, MH 440028",
      gstNumber: "27AAACG1234F1Z2",
    },
  });
  const malabar = await db.supplier.create({
    data: {
      companyName: "Malabar Wood Suppliers",
      contactPerson: "Anil Kumar",
      phone: "+91 99460 55441",
      email: "orders@malabarwood.co.in",
      address: "18/2 Timber Depot Road, Kozhikode, KL 673001",
      gstNumber: "32AABCM5678K1Z4",
    },
  });

  // ── Customer ──
  const abcFurniture = await db.customer.create({
    data: {
      companyName: "ABC Furniture Pvt Ltd",
      contactPerson: "Priya Sharma",
      phone: "+91 98111 22334",
      email: "procurement@abcfurniture.in",
      billingAddress: "402, Business Bay, Pune, MH 411001",
      shippingAddress: "Warehouse 7, Chakan MIDC, Pune, MH 410501",
      gstNumber: "27AABCA1234A1Z5",
    },
  });
  await db.customer.create({
    data: {
      companyName: "Decora Interiors LLP",
      contactPerson: "Vikram Desai",
      phone: "+91 99090 78781",
      email: "buy@decorainteriors.in",
      billingAddress: "Shop 9, MG Road, Bengaluru, KA 560001",
      shippingAddress: "Godown 3, Hosur Road, Bengaluru, KA 560095",
      gstNumber: "29AAGCD9012L1Z8",
    },
  });

  // ── Raw materials (opening stock via PURCHASE ledger entries) ──
  const mkMaterial = async (
    name: string,
    sku: string,
    category: string,
    unit: string,
    qty: number,
    rate: number,
    lot: string,
    po: string,
    supplierId: number,
    days: number
  ) => {
    const mat = await db.rawMaterial.create({
      data: { name, skuCode: sku, category, unit, currentStock: qty, unitPurchaseRate: rate },
    });
    await db.inventoryTransaction.create({
      data: {
        timestamp: daysAgo(days),
        itemType: "RAW_MATERIAL",
        itemId: mat.id,
        itemName: name,
        referenceType: "PURCHASE",
        referenceNumber: po,
        lotNumber: lot,
        stockIn: qty,
        stockOut: 0,
        balanceAfter: qty,
        unitRate: rate,
        supplierId,
        notes: `Opening purchase of ${qty} ${unit} @ ₹${rate}/${unit} from supplier`,
      },
    });
    return mat;
  };

  const teak = await mkMaterial("Teak Timber", "RM-TEAK-001", "Hardwood", "CFT", 1000, 2000, "LOT-RAW-TEAK-001", "PO-0001", greenply.id, 30);
  const pine = await mkMaterial("Pine Timber", "RM-PINE-001", "Softwood", "CFT", 500, 900, "LOT-RAW-PINE-001", "PO-0002", malabar.id, 25);
  await mkMaterial("Plywood", "RM-PLY-001", "Sheet Goods", "Sheets", 100, 1200, "LOT-RAW-PLY-001", "PO-0003", greenply.id, 20);

  // ── Finished products ──
  const mkProduct = async (
    name: string,
    sku: string,
    category: string,
    price: number,
    openingQty: number,
    openingLot: string,
    openingRef: string
  ) => {
    const prod = await db.finishedProduct.create({
      data: { name, skuCode: sku, category, sellingPrice: price, taxRatePercent: 18, currentStock: openingQty },
    });
    if (openingQty > 0) {
      await db.inventoryTransaction.create({
        data: {
          timestamp: daysAgo(18),
          itemType: "FINISHED_PRODUCT",
          itemId: prod.id,
          itemName: name,
          referenceType: "PROCESSING_OUTPUT",
          referenceNumber: openingRef,
          lotNumber: openingLot,
          stockIn: openingQty,
          stockOut: 0,
          balanceAfter: openingQty,
          notes: "Opening finished-goods entry",
        },
      });
    }
    return prod;
  };

  const teakPlank = await mkProduct("Finished Teak Plank", "FP-TEAK-P-001", "Plank", 3200, 0, "", "");
  const teakBeam = await mkProduct("Teak Beam", "FP-TEAK-B-001", "Beam", 3500, 0, "", "");
  const pinePlank = await mkProduct("Pine Plank", "FP-PINE-P-001", "Plank", 1500, 0, "", "");
  const timberSections = await mkProduct("Smaller Timber Pieces", "FP-TEAK-S-001", "Secondary", 900, 0, "", "");

  let teakPlankStock = 0;
  let timberSectionsStock = 0;

  // ── Processing batch PB-001 ──
  // Input: 500 CFT Teak Timber (LOT-RAW-TEAK-001)
  // Output: 400 CFT Finished Teak Plank (LOT-FIN-TEAK-001), 60 CFT Smaller Timber Pieces (LOT-FIN-SECT-001), 40 CFT WASTE
  const batch = await db.processingBatch.create({
    data: {
      batchNumber: "PB-0001",
      processingDate: daysAgo(12),
      notes: "Premium teak conversion run — sawmill line 2",
      wastePercentage: 8,
      totalInputQty: 500,
      totalOutputQty: 460,
      totalWasteQty: 40,
      status: "COMPLETED",
    },
  });
  await db.batchInputItem.create({
    data: { batchId: batch.id, rawMaterialId: teak.id, lotNumber: "LOT-RAW-TEAK-001", quantityConsumed: 500, unit: "CFT" },
  });
  await db.batchOutputItem.create({
    data: { batchId: batch.id, productId: teakPlank.id, lotNumber: "LOT-FIN-TEAK-001", outputType: "FINISHED", quantityProduced: 400, unit: "CFT" },
  });
  await db.batchOutputItem.create({
    data: { batchId: batch.id, productId: timberSections.id, lotNumber: "LOT-FIN-SECT-001", outputType: "SECONDARY", quantityProduced: 60, unit: "CFT" },
  });
  await db.batchOutputItem.create({
    data: { batchId: batch.id, productId: null, lotNumber: "WASTE-PB-0001-01", outputType: "WASTE", quantityProduced: 40, unit: "CFT" },
  });

  // Materialize output stock on the products + consumed raw material
  teakPlankStock = 400;
  timberSectionsStock = 60;
  await db.finishedProduct.update({ where: { id: teakPlank.id }, data: { currentStock: teakPlankStock } });
  await db.finishedProduct.update({ where: { id: timberSections.id }, data: { currentStock: timberSectionsStock } });
  // Teak consumed by the batch: 1000 -> 500
  await db.rawMaterial.update({ where: { id: teak.id }, data: { currentStock: 500 } });

  // Ledger: consume teak 1000 -> 500
  await db.inventoryTransaction.create({
    data: {
      timestamp: daysAgo(12),
      itemType: "RAW_MATERIAL",
      itemId: teak.id,
      itemName: "Teak Timber",
      referenceType: "PROCESSING_INPUT",
      referenceNumber: "PB-0001",
      lotNumber: "LOT-RAW-TEAK-001",
      stockIn: 0,
      stockOut: 500,
      balanceAfter: 500,
      notes: "Consumed by processing batch PB-0001",
    },
  });
  // Ledger: produce planks 0 -> 400
  await db.inventoryTransaction.create({
    data: {
      timestamp: daysAgo(12),
      itemType: "FINISHED_PRODUCT",
      itemId: teakPlank.id,
      itemName: "Finished Teak Plank",
      referenceType: "PROCESSING_OUTPUT",
      referenceNumber: "PB-0001",
      lotNumber: "LOT-FIN-TEAK-001",
      stockIn: 400,
      stockOut: 0,
      balanceAfter: 400,
      notes: "Finished output from PB-0001",
    },
  });
  // Ledger: produce sections 0 -> 60
  await db.inventoryTransaction.create({
    data: {
      timestamp: daysAgo(12),
      itemType: "FINISHED_PRODUCT",
      itemId: timberSections.id,
      itemName: "Smaller Timber Pieces",
      referenceType: "PROCESSING_OUTPUT",
      referenceNumber: "PB-0001",
      lotNumber: "LOT-FIN-SECT-001",
      stockIn: 60,
      stockOut: 0,
      balanceAfter: 60,
      notes: "Secondary output from PB-0001",
    },
  });

  // ── Invoice INV-0001 (confirmed) ──
  // 50 CFT Finished Teak Plank from LOT-FIN-TEAK-001 @ ₹3,200, GST 18%
  const lineSubtotal = 50 * 3200; // 160000
  const lineTax = lineSubtotal * 0.18; // 28800
  const invoice = await db.invoice.create({
    data: {
      invoiceNumber: "INV-0001",
      customerId: abcFurniture.id,
      invoiceDate: withinThisMonth(daysAgo(5)),
      subtotal: lineSubtotal,
      taxTotal: lineTax,
      grandTotal: lineSubtotal + lineTax,
      status: "CONFIRMED",
    },
  });
  await db.invoiceItem.create({
    data: {
      invoiceId: invoice.id,
      productId: teakPlank.id,
      lotNumber: "LOT-FIN-TEAK-001",
      quantity: 50,
      unitPrice: 3200,
      taxRatePercent: 18,
      taxAmount: lineTax,
      lineTotal: lineSubtotal + lineTax,
    },
  });
  // Materialize sale deduction (stock 400 -> 350)
  teakPlankStock = 350;
  await db.finishedProduct.update({ where: { id: teakPlank.id }, data: { currentStock: teakPlankStock } });

  // Ledger: sale 400 -> 350
  await db.inventoryTransaction.create({
    data: {
      timestamp: withinThisMonth(daysAgo(5)),
      itemType: "FINISHED_PRODUCT",
      itemId: teakPlank.id,
      itemName: "Finished Teak Plank",
      referenceType: "SALE",
      referenceNumber: "INV-0001",
      lotNumber: "LOT-FIN-TEAK-001",
      stockIn: 0,
      stockOut: 50,
      balanceAfter: 350,
      notes: "Sold to ABC Furniture Pvt Ltd",
    },
  });

  return { ok: true, message: "Database seeded with assessment sample data" };
}
