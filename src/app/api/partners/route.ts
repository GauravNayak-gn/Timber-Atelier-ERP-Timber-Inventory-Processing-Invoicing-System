import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { round2 } from "@/lib/api-error";
import type { PartnerCustomer, PartnerStats, PartnerSupplier } from "@/lib/types";

export async function GET() {
  try {
    const [suppliers, customers, purchaseEntries, invoices] = await Promise.all([
      db.supplier.findMany({ orderBy: { companyName: "asc" } }),
      db.customer.findMany({ orderBy: { companyName: "asc" } }),
      db.inventoryTransaction.findMany({
        where: { referenceType: "PURCHASE", supplierId: { not: null } },
        orderBy: { timestamp: "desc" },
      }),
      db.invoice.findMany({ include: { customer: true }, orderBy: { invoiceDate: "desc" } }),
    ]);

    const supplierStats = new Map<
      number,
      { count: number; value: number; qty: number; last: Date | null; materials: Set<string> }
    >();
    for (const entry of purchaseEntries) {
      if (entry.supplierId == null) continue;
      const agg = supplierStats.get(entry.supplierId) ?? {
        count: 0,
        value: 0,
        qty: 0,
        last: null as Date | null,
        materials: new Set<string>(),
      };
      agg.count += 1;
      agg.value += entry.stockIn * entry.unitRate;
      agg.qty += entry.stockIn;
      if (!agg.last || entry.timestamp > agg.last) agg.last = entry.timestamp;
      agg.materials.add(entry.itemName);
      supplierStats.set(entry.supplierId, agg);
    }

    const customerStats = new Map<
      number,
      { count: number; confirmed: number; cancelled: number; billed: number; last: Date | null }
    >();
    for (const inv of invoices) {
      const agg = customerStats.get(inv.customerId) ?? {
        count: 0,
        confirmed: 0,
        cancelled: 0,
        billed: 0,
        last: null as Date | null,
      };
      agg.count += 1;
      if (inv.status === "CONFIRMED") {
        agg.confirmed += 1;
        agg.billed += inv.grandTotal;
      } else {
        agg.cancelled += 1;
      }
      if (!agg.last || inv.invoiceDate > agg.last) agg.last = inv.invoiceDate;
      customerStats.set(inv.customerId, agg);
    }

    const mappedSuppliers: PartnerSupplier[] = suppliers.map((s) => {
      const agg = supplierStats.get(s.id);
      return {
        id: s.id,
        companyName: s.companyName,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        gstNumber: s.gstNumber,
        purchaseCount: agg?.count ?? 0,
        purchaseValue: round2(agg?.value ?? 0),
        totalQuantity: round2(agg?.qty ?? 0),
        lastPurchaseDate: agg?.last ? agg.last.toISOString() : null,
        materials: agg ? Array.from(agg.materials).sort() : [],
      };
    });

    const mappedCustomers: PartnerCustomer[] = customers.map((c) => {
      const agg = customerStats.get(c.id);
      return {
        id: c.id,
        companyName: c.companyName,
        contactPerson: c.contactPerson,
        phone: c.phone,
        email: c.email,
        billingAddress: c.billingAddress,
        shippingAddress: c.shippingAddress,
        gstNumber: c.gstNumber,
        invoiceCount: agg?.count ?? 0,
        confirmedCount: agg?.confirmed ?? 0,
        cancelledCount: agg?.cancelled ?? 0,
        totalBilled: round2(agg?.billed ?? 0),
        lastInvoiceDate: agg?.last ? agg.last.toISOString() : null,
      };
    });

    const payload: PartnerStats = {
      suppliers: mappedSuppliers,
      customers: mappedCustomers,
    };
    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
