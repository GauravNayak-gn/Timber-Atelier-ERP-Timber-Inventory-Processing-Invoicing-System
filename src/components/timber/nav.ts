/** Timber ERP — navigation model shared by sidebar, mobile sheet & header. */
import {
  Factory,
  GitBranch,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScrollText,
  TreePine,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ViewId =
  | "dashboard"
  | "materials"
  | "processing"
  | "products"
  | "partners"
  | "invoicing"
  | "traceability"
  | "ledger";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

export const NAV: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    subtitle: "The atelier at a glance — stock, sales, waste",
  },
  {
    id: "materials",
    label: "Raw Materials",
    icon: TreePine,
    title: "Raw Materials",
    subtitle: "Timber, plywood & sheet goods inventory",
  },
  {
    id: "processing",
    label: "Processing",
    icon: Factory,
    title: "Processing",
    subtitle: "Build conversion batches from raw lots",
  },
  {
    id: "products",
    label: "Products",
    icon: Package,
    title: "Finished Goods",
    subtitle: "Planks, beams & secondary pieces",
  },
  {
    id: "partners",
    label: "Partners",
    icon: Users,
    title: "Partners",
    subtitle: "Suppliers & customers with trading activity",
  },
  {
    id: "invoicing",
    label: "Invoicing",
    icon: ReceiptText,
    title: "Invoicing",
    subtitle: "GST invoices with lot-level lineage",
  },
  {
    id: "traceability",
    label: "Traceability",
    icon: GitBranch,
    title: "Traceability Explorer",
    subtitle: "Follow any lot from supplier to sale",
  },
  {
    id: "ledger",
    label: "Audit Ledger",
    icon: ScrollText,
    title: "Audit Ledger",
    subtitle: "Append-only stock movement history",
  },
];
