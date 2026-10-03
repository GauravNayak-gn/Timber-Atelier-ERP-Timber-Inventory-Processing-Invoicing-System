"use client";

import * as React from "react";

/** Cross-view quick actions dispatched via window events (used by the command palette). */
export type AppAction =
  | { type: "new-purchase" }
  | { type: "new-batch" }
  | { type: "new-invoice" }
  /** Deep-link: switch to Invoicing → History and open the matching invoice drawer. */
  | { type: "open-invoice"; invoiceNumber: string }
  /** Deep-link: switch to Processing and open the matching batch report. */
  | { type: "open-batch"; batchNumber: string }
  /** Deep-link: switch to Partners → Suppliers and open the supplier payables drawer. */
  | { type: "open-supplier"; supplierId: number; supplierName: string }
  /** Deep-link: payables drawer + auto-open the Pay dialog on the supplier's most-outstanding bill. */
  | { type: "open-supplier-pay"; supplierId: number; supplierName: string };

const ACTION_EVENT = "timber:action";

export function dispatchAppAction(action: AppAction) {
  window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: action }));
}

/** Subscribe to quick actions. Handler identity should be stable (useCallback). */
export function useAppAction(handler: (action: AppAction) => void) {
  React.useEffect(() => {
    const fn = (e: Event) => handler((e as CustomEvent).detail);
    window.addEventListener(ACTION_EVENT, fn);
    return () => window.removeEventListener(ACTION_EVENT, fn);
  }, [handler]);
}
