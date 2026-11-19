import type { BoardTicket } from "@/lib/orders-data";

export type ActionKind = "addPo" | "invoice" | "exportBilling" | "reminder" | "note" | "payment" | "moveBack" | "cancel" | "view";
export type OpenAction = (kind: ActionKind, ticket: BoardTicket) => void;
