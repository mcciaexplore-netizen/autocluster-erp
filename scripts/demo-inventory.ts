/**
 * Inventory demo (brief section 14): 4 suppliers, 26 items, materials lists, and 6 months of
 * history: 41 past jobs (quotation -> ticket -> PO -> invoice -> paid) with materials recorded,
 * regular internal use, expired batches written off and one completed stock count.
 *
 * Situations at the end: 3 items below the reorder level and 1 out of stock (2 marked "Ordered",
 * one of them late), 2 batches expiring within 30 days, 1 expired batch still in stock,
 * 2 slow-moving items, and the imported SLA resin rate up about 18% since the first delivery.
 *
 * How it works: the whole history is first played through in memory (receipts always before use,
 * the batch that expires first is used first, exactly like the stock writer), then saved through
 * the real writers in date order. A fixed random seed makes every reset the same.
 * Runs before the story quotations, so those keep the last numbers.
 */
import { put } from "@vercel/blob";
import Decimal from "decimal.js";
import { eq, inArray, sql } from "drizzle-orm";
import type { DB, Tx } from "../db/client";
import { saveCountLine, startCount } from "../db/count-writer";
import { createItem, createSupplier, setServiceMaterials } from "../db/inv-master-writer";
import { addInvoice } from "../db/invoice-writer";
import { recordPayment } from "../db/payment-writer";
import { addPurchaseOrder, registerFile } from "../db/po-writer";
import { createQuotation } from "../db/quote-writer";
import { markOrdered } from "../db/reorder-writer";
import * as s from "../db/schema";
import { adjustStock, completeCount, issueStock, receiveStock } from "../db/stock-writer";
import { changeQuotationStatus } from "../db/ticket-writer";
import { blobAuth, blobConfigured } from "../lib/blob";
import { uploadPath } from "../lib/files";
import { formatDate } from "../lib/format";
import { billableQuantity, financialYear, paiseToRupeeString, toPaise } from "../lib/pricing";
import { DEFAULT_TERMS } from "../lib/settings-shared";
import { addDays, daysBetween, todayInIndia } from "../lib/tickets";
import { EMPTY_ITEM_FORM, EMPTY_SUPPLIER_FORM } from "../lib/validation/inventory";
import { samplePdf, type DemoOrdersOptions } from "./demo-orders";

type Q = Partial<{ ccPerPart: number; parts: number; hours: number; samples: number }>;

// ---- fixed random numbers ------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- suppliers and items -------------------------------------------------------------------------
const SUPPLIERS = {
  DRP: { name: "Deccan Resins & Polymers", contactName: "Mr. Sanjay Kale", phone: "9822011111", email: "sales@deccanresins.example", gstin: "27AAFCD2345K1Z8", address: "Shed 14, Bhosari MIDC, Pune 411026", bill: "DRP" },
  PMS: { name: "Pune Metal Stockists", contactName: "Mr. Imran Shaikh", phone: "9881022222", email: "orders@punemetal.example", gstin: "27AAGFP6789L1Z3", address: "Gultekdi Market Yard, Pune 411037", bill: "PMS" },
  LCS: { name: "LabChem Supplies Pune", contactName: "Ms. Kavita Rao", phone: "9970033333", email: "kavita@labchempune.example", gstin: "27AAHCL3456M1Z1", address: "Office 7, Shivajinagar, Pune 411005", bill: "LCS" },
  PTM: { name: "Precision Tools Mart", contactName: "Mr. Vikram Jain", phone: "9823044444", email: "sales@precisiontools.example", gstin: "27AAJFP7890N1Z6", address: "Kasarwadi, Pune-Mumbai Road, Pune 411034", bill: "PTM" },
} as const;
type Sup = keyof typeof SUPPLIERS;

interface ItemDef {
  name: string;
  cat: string;
  depts: string[];
  unit: string;
  pack?: [string, number];
  lvl: number;
  rq: number;
  lead: number;
  sup: Sup;
  track?: boolean;
  shelf?: number; // days from receipt to expiry, for batch items
  place: string;
  hsn: string;
  rate: number | ((day: number) => number);
  batch?: string;
  /** No automatic re-stocking: receipts are only the ones listed (situation items). */
  noAuto?: boolean;
  /** No automatic re-stocking from this day on, so the item ends low. */
  noAutoFrom?: number;
  /** Ends at or below the reorder level (trimmed to this if it ends higher). */
  low?: number;
}

// SLA imported resin: Rs. 13.50/ml at the first delivery, rising to Rs. 15.93 (+18%).
const slaRate = (d: number) => (d < -110 ? 13.5 : d < -65 ? 14.2 : d < -30 ? 14.9 : 15.93);

const ITEMS = {
  slaImp: { name: "SLA resin, imported (grey)", cat: "Raw material", depts: ["RPT"], unit: "ml", pack: ["Bottle", 1000], lvl: 2000, rq: 2000, lead: 10, sup: "DRP", track: true, shelf: 300, place: "RPT lab, resin cabinet", hsn: "3907", rate: slaRate, batch: "SLI" },
  slaLocal: { name: "SLA resin, local (clear)", cat: "Raw material", depts: ["RPT"], unit: "ml", pack: ["Bottle", 1000], lvl: 2000, rq: 5000, lead: 7, sup: "DRP", track: true, shelf: 240, place: "RPT lab, resin cabinet", hsn: "3907", rate: 4.2, batch: "SLL" },
  fig4: { name: "Figure 4 black resin", cat: "Raw material", depts: ["RPT"], unit: "ml", pack: ["Bottle", 1000], lvl: 1000, rq: 2000, lead: 21, sup: "DRP", track: true, shelf: 300, place: "RPT lab, resin cabinet", hsn: "3907", rate: 22, batch: "F4", noAuto: true },
  pa12: { name: "SLS nylon powder (PA12)", cat: "Raw material", depts: ["RPT"], unit: "kg", pack: ["Bag", 20], lvl: 8, rq: 20, lead: 21, sup: "DRP", track: true, shelf: 540, place: "RPT lab, powder store", hsn: "3908", rate: 4200, batch: "PA" },
  origin: { name: "Origin 1 resin", cat: "Raw material", depts: ["RPT"], unit: "ml", pack: ["Bottle", 1000], lvl: 1000, rq: 2000, lead: 21, sup: "DRP", track: true, shelf: 365, place: "RPT lab, resin cabinet", hsn: "3907", rate: 18, batch: "OR" },
  ipa: { name: "Isopropyl alcohol (IPA)", cat: "Lab chemical", depts: ["RPT", "RPL"], unit: "L", pack: ["Can", 5], lvl: 10, rq: 20, lead: 5, sup: "LCS", place: "Chemical store, shelf 1", hsn: "2905", rate: 180 },
  film: { name: "Build plate film", cat: "Consumable", depts: ["RPT"], unit: "pcs", pack: ["Pack", 10], lvl: 6, rq: 20, lead: 14, sup: "PTM", place: "RPT lab, drawer 3", hsn: "3920", rate: 350 },
  gloves: { name: "Nitrile gloves", cat: "Consumable", depts: ["RPT", "RPL"], unit: "pcs", pack: ["Box", 100], lvl: 200, rq: 500, lead: 5, sup: "LCS", place: "Main store, rack A", hsn: "4015", rate: (d: number) => (d < -90 ? 6 : 6.3), noAutoFrom: -75, low: 140 },
  sandpaper: { name: "Sandpaper sheets (assorted)", cat: "Consumable", depts: ["RPT"], unit: "pcs", pack: ["Pack", 50], lvl: 30, rq: 100, lead: 7, sup: "PTM", place: "RPT lab, drawer 2", hsn: "6805", rate: 18 },
  al: { name: "Aluminium 6061 block", cat: "Raw material", depts: ["PPF"], unit: "kg", lvl: 40, rq: 100, lead: 5, sup: "PMS", place: "PPF bay, metal rack", hsn: "7604", rate: 380 },
  ms: { name: "Mild steel bar (EN8)", cat: "Raw material", depts: ["PPF"], unit: "kg", lvl: 40, rq: 100, lead: 5, sup: "PMS", place: "PPF bay, metal rack", hsn: "7214", rate: 85 },
  delrin: { name: "Delrin rod (POM), 50 mm", cat: "Raw material", depts: ["PPF"], unit: "m", lvl: 2, rq: 6, lead: 10, sup: "PMS", place: "PPF bay, plastics rack", hsn: "3916", rate: 950 },
  em10: { name: "Carbide end mill, 10 mm", cat: "Tool", depts: ["PPF"], unit: "pcs", lvl: 5, rq: 10, lead: 10, sup: "PTM", place: "PPF tool crib", hsn: "8207", rate: 1450 },
  em6: { name: "Carbide end mill, 6 mm", cat: "Tool", depts: ["PPF"], unit: "pcs", lvl: 5, rq: 10, lead: 10, sup: "PTM", place: "PPF tool crib", hsn: "8207", rate: 980, noAutoFrom: -100, low: 3 },
  coolant: { name: "Coolant (soluble oil)", cat: "Consumable", depts: ["PPF"], unit: "L", pack: ["Can", 20], lvl: 20, rq: 40, lead: 7, sup: "PTM", place: "PPF bay, oil store", hsn: "3403", rate: (d: number) => (d < -60 ? 240 : 250), noAutoFrom: -60, low: 14 },
  nacl: { name: "Sodium chloride, salt spray grade", cat: "Lab chemical", depts: ["ENV"], unit: "kg", pack: ["Bag", 25], lvl: 25, rq: 50, lead: 7, sup: "LCS", track: true, shelf: 365, place: "ENV lab, chemical shelf", hsn: "2501", rate: 65, batch: "NC" },
  water: { name: "Distilled water", cat: "Lab chemical", depts: ["ENV", "RPL"], unit: "L", pack: ["Can", 20], lvl: 100, rq: 200, lead: 3, sup: "LCS", place: "ENV lab, under bench", hsn: "2851", rate: 18 },
  filter: { name: "Test chamber filter", cat: "Spare part", depts: ["ENV"], unit: "pcs", lvl: 4, rq: 10, lead: 14, sup: "PTM", place: "ENV lab, spares cupboard", hsn: "8421", rate: 1200 },
  pans: { name: "DSC aluminium pans", cat: "Consumable", depts: ["RPL"], unit: "pcs", pack: ["Box", 100], lvl: 100, rq: 200, lead: 14, sup: "LCS", place: "RPL lab, drawer 1", hsn: "7616", rate: 45 },
  n2: { name: "Nitrogen gas cylinder", cat: "Lab chemical", depts: ["RPL"], unit: "cylinder", lvl: 2, rq: 4, lead: 7, sup: "LCS", place: "Gas cylinder bay", hsn: "2804", rate: 2800, noAutoFrom: -70, low: 0 },
  xenon: { name: "Xenon lamp, 1800 W", cat: "Spare part", depts: ["RPL"], unit: "pcs", lvl: 1, rq: 2, lead: 30, sup: "PTM", place: "RPL lab, spares cupboard", hsn: "8539", rate: 38000 },
  quv: { name: "QUV lamps, UVA-340 (set of 8)", cat: "Spare part", depts: ["RPL"], unit: "set", lvl: 1, rq: 2, lead: 30, sup: "PTM", place: "RPL lab, spares cupboard", hsn: "8539", rate: 24000 },
  wipes: { name: "FTIR cleaning wipes", cat: "Consumable", depts: ["RPL"], unit: "pcs", pack: ["Box", 280], lvl: 280, rq: 560, lead: 7, sup: "LCS", place: "RPL lab, drawer 2", hsn: "4818", rate: 2.5 },
  grips: { name: "UTM grip inserts", cat: "Spare part", depts: ["RPL"], unit: "set", lvl: 2, rq: 4, lead: 21, sup: "PTM", place: "RPL lab, UTM cabinet", hsn: "8466", rate: 6500 },
  ethanol: { name: "Ethanol, absolute", cat: "Lab chemical", depts: ["RPL"], unit: "L", pack: ["Bottle", 2.5], lvl: 2.5, rq: 5, lead: 7, sup: "LCS", track: true, shelf: 365, place: "Chemical store, flammables cabinet", hsn: "2207", rate: 420, batch: "ET", noAuto: true },
} satisfies Record<string, ItemDef>;
type ItemKey = keyof typeof ITEMS;
const DEF = ITEMS as Record<ItemKey, ItemDef>;

/** Materials used per billing unit of each service (the Rate Card "Materials used" lists). */
const MATERIALS: Record<string, [ItemKey, number][]> = {
  "SLA - imported resin": [["slaImp", 1.15], ["ipa", 0.002]],
  "SLA - local resin": [["slaLocal", 1.2], ["ipa", 0.002]],
  "Figure 4 Standalone Pro, black": [["fig4", 1.1], ["ipa", 0.002]],
  SLS: [["pa12", 0.0015]],
  "Origin 1 SLA": [["origin", 1.1], ["ipa", 0.002]],
  "5-axis machining": [["al", 1.2], ["em10", 0.05], ["coolant", 0.1]],
  "3+1 axis machining": [["ms", 0.8], ["em6", 0.04], ["coolant", 0.1]],
  "Dust spray chamber": [["filter", 0.07]],
  "Mini salt spray chamber": [["nacl", 0.05], ["water", 0.5]],
  UTM: [["gloves", 2]],
  FTIR: [["wipes", 4], ["ethanol", 0.01]],
  "Xenon test chamber": [["water", 0.5]],
  "QUV Weather-Ometer": [["water", 0.2]],
  "Melt flow index": [["gloves", 2]],
  DSC: [["pans", 2]],
};

/** Three more fictional customers (GST / PAN numbers valid in format only). */
const NEW_CUSTOMERS = [
  {
    companyName: "Chakan EV Motors Pvt Ltd", category: "MSME" as const, udyamNo: "UDYAM-MH-26-0078901",
    addressLine1: "Plot B-12, Chakan MIDC Phase 2", addressLine2: null, city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "410501",
    gstin: "27AAKCC4567P1Z9", pan: "AAKCC4567P", tan: null,
    pocName: "Neha Bhosale", pocDesignation: "R&D Engineer", pocPhone: "9850012345", pocEmail: "neha.b@chakanev.example",
    isMcciaMember: true, mcciaMembershipId: "MCCIA/2023/06111", depts: ["RPT", "ENV"],
    services: ["SLA - imported resin", "SLA - local resin", "Origin 1 SLA", "SLS", "Figure 4 Standalone Pro, black", "Dust spray chamber", "Mini salt spray chamber"],
  },
  {
    companyName: "Bharat Plastomers Pvt Ltd", category: "TIER2" as const, udyamNo: null,
    addressLine1: "Gat No. 402, Talawade", addressLine2: "Dehu-Alandi Road", city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "411062",
    gstin: "27AAJCB8901Q1Z4", pan: "AAJCB8901Q", tan: "PNEB89012C",
    pocName: "Suresh Iyer", pocDesignation: "Lab Manager", pocPhone: "9960012345", pocEmail: "suresh.iyer@bharatplastomers.example",
    isMcciaMember: false, mcciaMembershipId: null, depts: ["RPL"],
    services: ["UTM", "Xenon test chamber", "QUV Weather-Ometer", "FTIR", "DSC"],
  },
  {
    companyName: "Talegaon Precision Castings", category: "MSME" as const, udyamNo: "UDYAM-MH-26-0091234",
    addressLine1: "Plot 77, Talegaon MIDC", addressLine2: null, city: "Talegaon Dabhade", state: "Maharashtra", stateCode: "27", pincode: "410507",
    gstin: "27AAFFT2345R1Z7", pan: "AAFFT2345R", tan: null,
    pocName: "Ganesh More", pocDesignation: "Works Manager", pocPhone: "9604012345", pocEmail: "ganesh.more@talegaoncastings.example",
    isMcciaMember: true, mcciaMembershipId: "MCCIA/2021/05733", depts: ["RPT", "PPF"],
    services: ["SLA - imported resin", "SLA - local resin", "SLS", "Origin 1 SLA", "Figure 4 Standalone Pro, black", "5-axis machining", "3+1 axis machining"],
  },
];

/** 41 past jobs: [days ago, service, customer, quantity]. Story customers (Sahyadri, Western Drive) are left out. */
const NASHIK = "Nashik Precision Tools";
const INDUS = "Indus Forge Tier One Pvt Ltd";
const KAVERI = "Kaveri Mobility Parts Pvt Ltd";
const DECCAN = "Deccan Polymers LLP";
const CHAKAN = "Chakan EV Motors Pvt Ltd";
const BHARAT = "Bharat Plastomers Pvt Ltd";
const TALEGAON = "Talegaon Precision Castings";
const JOBS: [number, string, string, Q, string][] = [
  [-176, "SLA - imported resin", NASHIK, { ccPerPart: 60, parts: 4 }, "Fixture housing prototypes"],
  [-172, "SLS", TALEGAON, { ccPerPart: 100, parts: 6 }, "Core box trial parts"],
  [-168, "5-axis machining", INDUS, { hours: 8 }, "Impeller finishing"],
  [-165, "Mini salt spray chamber", KAVERI, { hours: 96 }, "Neutral salt spray, ASTM B117"],
  [-161, "Origin 1 SLA", CHAKAN, { ccPerPart: 40, parts: 5 }, "Connector clips"],
  [-158, "DSC", DECCAN, { samples: 6 }, "Melting point check"],
  [-155, "SLA - local resin", TALEGAON, { ccPerPart: 80, parts: 3 }, "Pattern prototypes"],
  [-151, "3+1 axis machining", INDUS, { hours: 12 }, "Bracket trial batch"],
  [-148, "Figure 4 Standalone Pro, black", NASHIK, { ccPerPart: 25, parts: 8 }, "Knob prototypes"],
  [-144, "UTM", BHARAT, { samples: 5 }, "Tensile test, ASTM D412"],
  [-140, "SLA - imported resin", CHAKAN, { ccPerPart: 75, parts: 4 }, "Battery cover prototypes"],
  [-137, "FTIR", DECCAN, { samples: 8 }, "Polymer identification"],
  [-133, "Dust spray chamber", KAVERI, { hours: 24 }, "IP5X dust test"],
  [-129, "Xenon test chamber", BHARAT, { hours: 200, samples: 3 }, "Weathering, ISO 4892-2"],
  [-126, "SLS", NASHIK, { ccPerPart: 90, parts: 5 }, "Jig prototypes"],
  [-122, "Origin 1 SLA", TALEGAON, { ccPerPart: 30, parts: 6 }, "Small gear prototypes"],
  [-118, "5-axis machining", TALEGAON, { hours: 6 }, "Mould insert finishing"],
  [-115, "SLA - local resin", CHAKAN, { ccPerPart: 120, parts: 2 }, "Display model"],
  [-111, "Mini salt spray chamber", CHAKAN, { hours: 72 }, "Charger bracket corrosion test"],
  [-108, "SLA - imported resin", TALEGAON, { ccPerPart: 50, parts: 5 }, "Casting pattern prototypes"],
  [-104, "QUV Weather-Ometer", BHARAT, { hours: 300, samples: 3 }, "UV ageing, ASTM G154"],
  [-100, "3+1 axis machining", TALEGAON, { hours: 10 }, "Fixture plates"],
  [-97, "Figure 4 Standalone Pro, black", CHAKAN, { ccPerPart: 30, parts: 8 }, "Switch housing prototypes"],
  [-93, "Melt flow index", DECCAN, { samples: 6 }, "ASTM D1238"],
  [-89, "SLA - imported resin", NASHIK, { ccPerPart: 90, parts: 3 }, "Gauge body prototypes"],
  [-86, "UTM", DECCAN, { samples: 6 }, "Tensile test, ASTM D638"],
  [-82, "SLS", CHAKAN, { ccPerPart: 150, parts: 3 }, "Duct prototypes"],
  [-78, "Dust spray chamber", CHAKAN, { hours: 16 }, "IP5X dust test, motor controller"],
  [-75, "SLA - local resin", NASHIK, { ccPerPart: 100, parts: 3 }, "Visual prototypes"],
  [-71, "5-axis machining", INDUS, { hours: 10 }, "Impeller trial batch"],
  [-68, "DSC", BHARAT, { samples: 4 }, "Glass transition check"],
  [-64, "SLA - imported resin", CHAKAN, { ccPerPart: 60, parts: 5 }, "Charger port cover prototypes"],
  [-60, "FTIR", BHARAT, { samples: 6 }, "Compound check"],
  [-57, "Mini salt spray chamber", KAVERI, { hours: 120 }, "Neutral salt spray, ASTM B117"],
  [-53, "Figure 4 Standalone Pro, black", TALEGAON, { ccPerPart: 40, parts: 6 }, "Pattern inserts"],
  [-50, "3+1 axis machining", INDUS, { hours: 8 }, "Bracket second batch"],
  [-46, "SLA - imported resin", TALEGAON, { ccPerPart: 80, parts: 4 }, "Core prototypes"],
  [-42, "UTM", BHARAT, { samples: 4 }, "Tear strength, ASTM D624"],
  [-38, "SLS", TALEGAON, { ccPerPart: 120, parts: 4 }, "Fixture prototypes"],
  [-34, "SLA - imported resin", NASHIK, { ccPerPart: 70, parts: 4 }, "Housing prototypes, revision B"],
  [-31, "5-axis machining", TALEGAON, { hours: 6 }, "Die insert finishing"],
];

// ---- the plan (events), worked out in memory first ------------------------------------------------
type Line = { item: ItemKey; qty: string; batchNo?: string; expiry?: string; rate?: string };
type Ev =
  | { kind: "receive"; day: number; sup: Sup; lines: Line[] }
  | { kind: "job"; day: number; n: number }
  | { kind: "jobUse"; day: number; n: number; lines: Line[] }
  | { kind: "use"; day: number; purpose: string; note: string; lines: Line[] }
  | { kind: "writeoff"; day: number; item: ItemKey; batchNo: string; qty: string }
  | { kind: "count"; day: number; category: string; diffs: Partial<Record<ItemKey, number>> }
  | { kind: "ordered"; day: number; sup: Sup; method: "WHATSAPP" | "EMAIL"; lines: Line[] };
const ORDER: Record<Ev["kind"], number> = { receive: 0, job: 1, jobUse: 2, use: 3, writeoff: 4, count: 5, ordered: 6 };

const D = (v: Decimal.Value) => new Decimal(v);
const WHOLE = new Set(["pcs", "set", "cylinder", "ml"]);
/** A quantity in the item's unit as text: whole for ml and pieces, 3 decimals otherwise. */
const qtyOf = (item: ItemKey, v: Decimal.Value) => (WHOLE.has(DEF[item].unit) ? D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP) : D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP)).toFixed();
const rateOf = (item: ItemKey, day: number) => {
  const r = DEF[item].rate;
  return (typeof r === "function" ? r(day) : r).toFixed(4).replace(/\.?0+$/, "");
};
/** A pack-rounded receipt quantity (at least the reorder quantity). */
const packQty = (item: ItemKey, atLeast: Decimal.Value) => {
  const p = DEF[item].pack?.[1];
  const need = Decimal.max(D(atLeast), D(DEF[item].rq));
  return qtyOf(item, p ? need.div(p).ceil().mul(p) : need.ceil());
};

/** Stock in memory: batches per item, used with the same "expires first" rule as the stock writer. */
class Sim {
  batches = new Map<ItemKey, { no: string; exp: string | null; qty: Decimal }[]>();
  constructor(private today: string) {
    for (const k of Object.keys(ITEMS) as ItemKey[]) this.batches.set(k, []);
  }
  date = (day: number) => addDays(this.today, day);
  total = (k: ItemKey) => this.batches.get(k)!.reduce((a, b) => a.add(b.qty), D(0));
  usable(k: ItemKey, day: number) {
    const d = this.date(day);
    return this.batches
      .get(k)!
      .filter((b) => b.qty.gt(0) && (!b.exp || b.exp >= d))
      .sort((a, b) => (a.exp ?? "9999-12-31").localeCompare(b.exp ?? "9999-12-31") || a.no.localeCompare(b.no));
  }
  usableQty = (k: ItemKey, day: number) => this.usable(k, day).reduce((a, b) => a.add(b.qty), D(0));
  add(l: Line) {
    const list = this.batches.get(l.item)!;
    const no = l.batchNo ?? "";
    const b = list.find((x) => x.no === no);
    if (b) b.qty = b.qty.add(D(l.qty));
    else list.push({ no, exp: l.expiry ?? null, qty: D(l.qty) });
  }
  take(k: ItemKey, qty: Decimal.Value, day: number) {
    let left = D(qty);
    for (const b of this.usable(k, day)) {
      const t = Decimal.min(left, b.qty);
      b.qty = b.qty.sub(t);
      left = left.sub(t);
      if (left.lte(0)) break;
    }
    if (left.gt(0)) throw new Error(`Demo plan: not enough ${DEF[k].name} on day ${day}`);
  }
  takeAny(k: ItemKey, qty: Decimal.Value) {
    // A stock count loss: from the pool (count items don't keep batches).
    const b = this.batches.get(k)![0];
    b.qty = b.qty.sub(D(qty));
  }
}

function buildPlan(today: string) {
  const rnd = mulberry32(20261120);
  const vary = () => 0.95 + rnd() * 0.3;
  const batchSeq = new Map<ItemKey, number>();
  const sim = new Sim(today);
  const newBatch = (item: ItemKey, day: number, expiryDay?: number): Pick<Line, "batchNo" | "expiry"> => {
    const def = DEF[item];
    if (!def.track) return {};
    const n = (batchSeq.get(item) ?? 0) + 1;
    batchSeq.set(item, n);
    const d = sim.date(day);
    return { batchNo: `${def.batch}-${d.slice(2, 4)}${d.slice(5, 7)}-${n}`, expiry: sim.date(expiryDay ?? day + (def.shelf ?? 365)) };
  };
  const receipt = (day: number, item: ItemKey, qty: Decimal.Value, expiryDay?: number): Ev => ({
    kind: "receive",
    day,
    sup: DEF[item].sup,
    lines: [{ item, qty: qtyOf(item, qty), rate: rateOf(item, day), ...newBatch(item, day, expiryDay) }],
  });

  // 1. Planned receipts: first stock for every item, plus the ones the story needs.
  const evs: Ev[] = [];
  const firstDay: Record<Sup, number> = { DRP: -180, PMS: -179, LCS: -178, PTM: -177 };
  for (const k of Object.keys(ITEMS) as ItemKey[]) {
    if (["slaLocal", "fig4", "ethanol", "slaImp"].includes(k)) continue;
    evs.push(receipt(firstDay[DEF[k].sup], k, packQty(k, DEF[k].rq)));
  }
  evs.push(receipt(-180, "slaImp", 3000), receipt(-60, "slaImp", 1000), receipt(-20, "slaImp", 1000));
  // Local resin: the first batch expires (written off), the second expires in about 2 weeks.
  evs.push(receipt(-178, "slaLocal", 3000, -90), receipt(-100, "slaLocal", 5000, 15));
  // Figure 4: the first batch expires with stock left in it (still on the shelf).
  evs.push(receipt(-175, "fig4", 2000, -12), receipt(-60, "fig4", 2000));
  // Ethanol: the first bottles expire (written off), the next batch expires in about 12 days.
  evs.push(receipt(-170, "ethanol", 2.5, -50), receipt(-60, "ethanol", 5, 12));

  // 2. Jobs and the materials recorded on them (2 days after the job opened).
  JOBS.forEach(([day, svc, , q, ], n) => {
    evs.push({ kind: "job", day, n });
    const unitType = svc === "Xenon test chamber" || svc === "QUV Weather-Ometer" ? "PER_HOUR_3_SAMPLES" : q.ccPerPart ? "PER_CC" : q.hours ? "PER_HOUR" : "PER_SAMPLE";
    const billable = billableQuantity(unitType, q);
    const lines: Line[] = [];
    for (const [item, per] of MATERIALS[svc] ?? []) {
      let v = D(per).mul(billable).mul(vary());
      // Tools and spares are recorded whole: a 0.3 share of an end mill is 1 worn out 3 times in 10.
      if (["pcs", "set", "cylinder"].includes(DEF[item].unit)) v = D(Math.floor(v.toNumber() + rnd()));
      if (v.gt(0)) lines.push({ item, qty: qtyOf(item, v) });
    }
    if (n === 7) lines.push({ item: "delrin", qty: "0.6" }); // one early job also used a Delrin rod (now slow-moving)
    if (lines.length) evs.push({ kind: "jobUse", day: day + 2, n, lines });
  });

  // 3. Regular internal use.
  for (let day = -170; day <= -20; day += 30) {
    evs.push({ kind: "use", day, purpose: "Machine maintenance", note: "Monthly printer maintenance", lines: [{ item: "gloves", qty: "40" }, { item: "ipa", qty: "2" }, { item: "film", qty: "2" }, { item: "sandpaper", qty: "10" }] });
    evs.push({ kind: "use", day: day + 2, purpose: "Machine maintenance", note: "Monthly coolant top-up, CNC", lines: [{ item: "coolant", qty: "6" }] });
    evs.push({ kind: "use", day: day + 5, purpose: "Machine maintenance", note: "DSC nitrogen purge", lines: [{ item: "n2", qty: "1" }] });
  }
  for (let day = -160; day <= -40; day += 60) evs.push({ kind: "use", day, purpose: "Training", note: "New operator training, SLA printer", lines: [{ item: "gloves", qty: "30" }, { item: "slaLocal", qty: "250" }] });
  evs.push({ kind: "use", day: -130, purpose: "Trial run", note: "Print settings trial for thin walls", lines: [{ item: "slaImp", qty: "150" }] });
  evs.push({ kind: "use", day: -70, purpose: "Trial run", note: "SLS refresh ratio trial", lines: [{ item: "pa12", qty: "1.5" }] });
  evs.push({ kind: "use", day: -80, purpose: "Machine maintenance", note: "QUV lamps replaced", lines: [{ item: "quv", qty: "1" }] });
  evs.push({ kind: "use", day: -70, purpose: "Machine maintenance", note: "UTM grips worn, inserts replaced", lines: [{ item: "grips", qty: "1" }] });
  evs.push({ kind: "use", day: -60, purpose: "Machine maintenance", note: "Xenon lamp replaced after 1,500 hours", lines: [{ item: "xenon", qty: "1" }] });

  // 4. Expired batches written off (quantity worked out while playing the plan).
  evs.push({ kind: "writeoff", day: -85, item: "slaLocal", batchNo: "", qty: "0" });
  evs.push({ kind: "writeoff", day: -45, item: "ethanol", batchNo: "", qty: "0" });

  // 5. One stock count of consumables, with small differences.
  evs.push({ kind: "count", day: -25, category: "Consumable", diffs: { gloves: -6, wipes: 4, sandpaper: -2 } });

  // ---- play it through, adding re-stocking as a store would ----
  const sorted = () => evs.sort((a, b) => a.day - b.day || ORDER[a.kind] - ORDER[b.kind]);
  sorted();
  const played: Ev[] = [];
  const recent = new Map<ItemKey, Decimal>(); // used in the last 90 days
  const restock = (item: ItemKey, need: Decimal, day: number) => {
    const def = DEF[item];
    if (def.noAuto || (def.noAutoFrom != null && day >= def.noAutoFrom)) return false;
    const r = receipt(day, item, packQty(item, need));
    played.push(r);
    sim.add((r as Extract<Ev, { kind: "receive" }>).lines[0]);
    return true;
  };
  const takeLines = (e: { day: number; lines: Line[] }) => {
    const kept: Line[] = [];
    for (const l of e.lines) {
      const def = DEF[l.item];
      let q = D(l.qty);
      // Re-stock when this use would take usable stock below the reorder level.
      if (sim.usableQty(l.item, e.day).sub(q).lt(def.lvl)) restock(l.item, q.add(def.lvl), e.day);
      const have = sim.usableQty(l.item, e.day);
      if (have.lt(q)) q = have; // an item kept low on purpose: record what was there
      if (q.lte(0)) continue;
      sim.take(l.item, q, e.day);
      if (e.day > -90) recent.set(l.item, (recent.get(l.item) ?? D(0)).add(q));
      kept.push({ ...l, qty: qtyOf(l.item, q) });
    }
    return kept;
  };
  for (const e of evs) {
    if (e.kind === "receive") {
      for (const l of e.lines) sim.add(l);
      played.push(e);
    } else if (e.kind === "jobUse" || e.kind === "use") {
      const lines = takeLines(e);
      if (lines.length) played.push({ ...e, lines });
    } else if (e.kind === "writeoff") {
      const d = sim.date(e.day);
      const b = sim.batches.get(e.item)!.find((x) => x.exp && x.exp < d && x.qty.gt(0));
      if (b) {
        played.push({ ...e, batchNo: b.no, qty: qtyOf(e.item, b.qty) });
        b.qty = D(0);
      }
    } else if (e.kind === "count") {
      for (const [k, diff] of Object.entries(e.diffs) as [ItemKey, number][]) {
        if (diff > 0) sim.add({ item: k, qty: String(diff) });
        else sim.takeAny(k, -diff);
      }
      played.push(e);
    } else played.push(e);
  }

  // ---- the end state: low items low, everything else comfortably stocked ----
  const end: Ev[] = [];
  for (const k of Object.keys(ITEMS) as ItemKey[]) {
    const def = DEF[k];
    const qty = sim.total(k);
    if (def.low != null) {
      if (qty.gt(def.low)) {
        const lines = [{ item: k, qty: qtyOf(k, qty.sub(def.low)) }];
        const why: Partial<Record<ItemKey, [string, string]>> = {
          n2: ["Machine maintenance", "DSC nitrogen purge"],
          em6: ["Machine maintenance", "Worn end mills scrapped after inspection"],
          coolant: ["Machine maintenance", "Coolant tank cleaned and refilled"],
          gloves: ["Training", "Operator training, all labs"],
        };
        const [purpose, note] = why[k] ?? ["Other", "Used"];
        end.push({ kind: "use", day: -9, purpose, note, lines });
        sim.take(k, qty.sub(def.low), -9);
      }
      continue;
    }
    // Enough for the reorder level, and for the lead time + safety days (+ 2 weeks) at the recent rate of use.
    const daily = (recent.get(k) ?? D(0)).div(90);
    const want = Decimal.max(D(def.lvl).mul(1.3), daily.mul(def.lead + 7 + 14), D(def.lvl).add(daily.mul(def.lead + 7 + 14)));
    if (qty.lte(want) && !def.noAuto) {
      const r = receipt(-8, k, packQty(k, want.sub(qty).add(def.lvl)));
      end.push(r);
      sim.add((r as Extract<Ev, { kind: "receive" }>).lines[0]);
    }
  }
  // Orders already sent: end mills 3 days ago, nitrogen 16 days ago (late: 7 days lead time).
  end.push({ kind: "ordered", day: -16, sup: "LCS", method: "EMAIL", lines: [{ item: "n2", qty: "4" }] });
  end.push({ kind: "ordered", day: -3, sup: "PTM", method: "WHATSAPP", lines: [{ item: "em6", qty: "10" }] });
  const all = [...played, ...end].sort((a, b) => a.day - b.day || ORDER[a.kind] - ORDER[b.kind]);
  return { events: all, final: new Map((Object.keys(ITEMS) as ItemKey[]).map((k) => [k, sim.total(k)])) };
}

// ---- saving it through the real writers ------------------------------------------------------------
export async function loadInventoryDemo(conn: DB | Tx, custIds: Record<string, string>, opts: DemoOrdersOptions) {
  const db = conn as DB; // the writers open their own (nested) transactions
  const log = opts.log ?? (() => {});
  const today = todayInIndia();
  const date = (day: number) => addDays(today, day);
  const plan = buildPlan(today);

  log("  4 suppliers, 26 items and materials lists for the rate card");
  const supId = {} as Record<Sup, string>;
  for (const [k, v] of Object.entries(SUPPLIERS) as [Sup, (typeof SUPPLIERS)[Sup]][]) {
    const r = await createSupplier(db, { ...EMPTY_SUPPLIER_FORM, name: v.name, contactName: v.contactName, phone: v.phone, email: v.email, gstin: v.gstin, address: v.address });
    supId[k] = r.id;
  }
  const [cats, units] = await Promise.all([db.select().from(s.invCategories), db.select().from(s.invUnits)]);
  const itemId = {} as Record<ItemKey, string>;
  for (const [k, d] of Object.entries(DEF) as [ItemKey, ItemDef][]) {
    const item = await createItem(db, {
      ...EMPTY_ITEM_FORM,
      name: d.name,
      categoryId: cats.find((c) => c.name === d.cat)!.id,
      deptCodes: d.depts,
      unitId: units.find((u) => u.name === d.unit)!.id,
      packName: d.pack?.[0] ?? "",
      packSize: d.pack ? String(d.pack[1]) : "",
      reorderLevel: String(d.lvl),
      reorderQty: String(d.rq),
      leadTimeDays: String(d.lead),
      preferredSupplierId: supId[d.sup],
      storagePlace: d.place,
      trackBatches: !!d.track,
      hsnCode: d.hsn,
    });
    itemId[k] = item.id;
  }
  const svcRows = await db.select().from(s.services);
  const svc = (name: string) => svcRows.find((x) => x.name === name)!;
  for (const [name, lines] of Object.entries(MATERIALS)) {
    await setServiceMaterials(db, svc(name).id, lines.map(([k, q]) => ({ itemId: itemId[k], qtyPerUnit: String(q) })));
  }

  log("  3 more customers for the past jobs");
  for (const c of NEW_CUSTOMERS) {
    const { depts, services: names, ...data } = c;
    const [row] = await db.insert(s.customers).values({ ...data, gstRegistered: true, status: "ACTIVE" }).returning();
    custIds[c.companyName] = row.id;
    await db.insert(s.customerDepartments).values(depts.map((deptCode) => ({ customerId: row.id, deptCode })));
    await db.insert(s.customerServices).values(names.map((n) => ({ customerId: row.id, serviceId: svc(n).id })));
  }

  const [purposes, reasons] = await Promise.all([db.select().from(s.invPurposes), db.select().from(s.invAdjustReasons)]);
  const purposeId = (n: string) => purposes.find((p) => p.name === n)!.id;
  const expiredReason = reasons.find((r) => r.name === "Expired")!.id;
  const billSeq: Record<Sup, number> = { DRP: 140, PMS: 2210, LCS: 870, PTM: 515 };
  const tickets = new Map<number, string[]>();
  let invSeq = 301;
  let poSeq = 1100;

  async function invoiceFile(fileName: string, rows: [string, string][]) {
    const bytes = await samplePdf("SAMPLE TAX INVOICE", rows);
    let path = uploadPath(opts.blobFolder, "INVOICE", fileName);
    if (blobConfigured()) {
      const b = await put(path, Buffer.from(bytes), { access: "private", addRandomSuffix: true, contentType: "application/pdf", ...blobAuth() });
      path = b.pathname;
      opts.onUpload?.(path);
    }
    return registerFile(db, { kind: "INVOICE", blobPath: path, fileName, size: bytes.length, mime: "application/pdf" });
  }
  const at = (d: string) => sql`(${d}::date + time '11:00') at time zone 'Asia/Kolkata'`;

  log(`  6 months of history: ${JOBS.length} past jobs, deliveries, internal use, a stock count (this takes a moment)`);
  for (const e of plan.events) {
    const d = date(e.day);
    if (e.kind === "receive") {
      await receiveStock(
        db,
        {
          supplierId: supId[e.sup],
          supplierBillNo: `${SUPPLIERS[e.sup].bill}/${financialYear(new Date(`${d}T00:00:00`)).slice(2)}/${billSeq[e.sup]++}`,
          supplierBillDate: d,
          docDate: d,
          lines: e.lines.map((l) => ({ itemId: itemId[l.item], qty: l.qty, rate: l.rate!, batchNo: l.batchNo ?? null, expiryDate: l.expiry ?? null })),
        },
        { today: d },
      );
    } else if (e.kind === "job") {
      const [, name, customer, q, notes] = JOBS[e.n];
      const v = svc(name);
      const quote = await createQuotation(db, {
        customerId: custIds[customer],
        quoteDate: addDays(d, -4),
        validUntil: addDays(d, 26),
        subject: `Quotation for ${name}`,
        notes: null,
        terms: DEFAULT_TERMS,
        status: "SENT",
        lines: [{ key: crypto.randomUUID(), serviceId: v.id, deptCode: v.deptCode, description: v.name, unitType: v.unitType, unitLabel: v.unitLabel, customRatePaise: null, notes, ...q }],
      });
      await changeQuotationStatus(db, quote.id, "ACCEPTED", today);
      const ts = await db.select().from(s.tickets).where(eq(s.tickets.quotationId, quote.id));
      const ids = ts.map((t) => t.id);
      tickets.set(e.n, ids);
      const taxable = ts.reduce((a, t) => a + toPaise(t.taxableValue), 0);
      const total = ts.reduce((a, t) => a + toPaise(t.totalAmount), 0);
      const poDate = addDays(d, 1);
      await addPurchaseOrder(db, { ticketIds: ids, poNumber: `PO/${poSeq++}`, poDate, poAmountPaise: taxable, fileId: null, notes: null }, today);
      const invDate = addDays(d, 8);
      const invoiceNumber = `MCCIA/${financialYear(new Date(`${invDate}T00:00:00`))}/0${invSeq++}`;
      const fileId = await invoiceFile(`SAMPLE-INVOICE-${invoiceNumber.replaceAll("/", "-")}.pdf`, [
        ["Invoice no.", invoiceNumber],
        ["Invoice date", formatDate(invDate)],
        ["Billed to", customer],
        ["Services", ts.map((t) => `${t.ticketNo}: ${t.snapshot.description}`).join("\n")],
        ["Invoice total incl. GST", `Rs. ${Number(paiseToRupeeString(total)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
      ]);
      const r = await addInvoice(db, { ticketIds: ids, invoiceNumber, invoiceDate: invDate, amountPaise: total, creditDays: 30, dueDate: addDays(invDate, 30), fileId }, today);
      const paidOn = daysBetween(addDays(d, 28), today) > 2 ? addDays(d, 28) : addDays(today, -2);
      await recordPayment(db, { invoiceId: r.invoiceId, amountPaise: total, tdsPaise: 0, paidOn, mode: "BANK", reference: `NEFT ${String(700000 + e.n * 1379).padStart(6, "0")}` }, today);
      // Move the history back to when it happened.
      for (const [type, when] of [["OPENED", d], ["PO_ADDED", poDate], ["INVOICE_UPLOADED", invDate], ["PAYMENT", paidOn], ["PAID", paidOn]] as const) {
        await db.execute(sql`update ticket_events set created_at = ${at(when)} where ticket_id = any(${sql.param(ids)}::uuid[]) and type = ${type}`);
      }
      await db.update(s.tickets).set({ createdAt: at(d), stageChangedAt: at(paidOn) }).where(inArray(s.tickets.id, ids));
      await db.update(s.quotations).set({ createdAt: at(addDays(d, -4)) }).where(eq(s.quotations.id, quote.id));
      await db.execute(sql`update payments set created_at = ${at(paidOn)} where invoice_id = ${r.invoiceId}`);
    } else if (e.kind === "jobUse") {
      await issueStock(db, { ticketId: tickets.get(e.n)![0], docDate: d, lines: e.lines.map((l) => ({ itemId: itemId[l.item], qty: l.qty })) }, { today: d });
    } else if (e.kind === "use") {
      await issueStock(db, { purposeId: purposeId(e.purpose), note: e.note, docDate: d, lines: e.lines.map((l) => ({ itemId: itemId[l.item], qty: l.qty })) }, { today: d });
    } else if (e.kind === "writeoff") {
      const [b] = await db.select().from(s.invBatches).where(sql`${s.invBatches.itemId} = ${itemId[e.item]} and ${s.invBatches.batchNo} = ${e.batchNo}`);
      await adjustStock(db, { note: `Batch ${e.batchNo} expired on ${formatDate(b.expiryDate)}: written off`, docDate: d, lines: [{ itemId: itemId[e.item], direction: "REMOVE", qty: e.qty, reasonId: expiredReason, batchId: b.id }] }, { today: d });
    } else if (e.kind === "count") {
      const c = await startCount(db, { categoryId: cats.find((x) => x.name === e.category)!.id }, { today: d });
      const lines = await db.select().from(s.invCountLines).where(eq(s.invCountLines.countId, c.id));
      for (const l of lines) {
        const k = (Object.keys(itemId) as ItemKey[]).find((x) => itemId[x] === l.itemId)!;
        await saveCountLine(db, l.id, D(l.systemQty).add(e.diffs[k] ?? 0).toFixed());
      }
      await completeCount(db, c.id, { today: d });
      await db.execute(sql`update inv_counts set started_at = ${at(d)} - interval '2 hours', completed_at = ${at(d)} where id = ${c.id}`);
      await db.execute(sql`update inv_count_lines set counted_at = ${at(d)} - interval '1 hour' where count_id = ${c.id}`);
    } else if (e.kind === "ordered") {
      await markOrdered(db, { supplierId: supId[e.sup], method: e.method, lines: e.lines.map((l) => ({ itemId: itemId[l.item], qty: l.qty })) }, { today: d });
      await db.execute(sql`update inv_reorder_sends set created_at = ${at(d)} where created_at > now() - interval '1 hour' and supplier_id = ${supId[e.sup]}`);
    }
  }
  // Each record's time of entry: the day it happened.
  await db.execute(sql`update inv_documents set created_at = (doc_date + time '17:00') at time zone 'Asia/Kolkata'`);
  await db.execute(sql`update inv_movements m set created_at = d.created_at from inv_documents d where d.id = m.document_id`);
  return { itemId, final: plan.final };
}

/** After the CRM demo adds the team: share the stock records out between them. */
export async function assignInventoryDoneBy(db: DB | Tx) {
  await db.execute(sql`
    with team as (select id, row_number() over (order by sort_order, name) - 1 as n, count(*) over () as c from team_members),
    docs as (select id, row_number() over (order by doc_date, seq) as r from inv_documents)
    update inv_documents d set done_by = t.id from docs, team t where docs.id = d.id and t.n = docs.r % t.c`);
}

export const DEMO_INVENTORY_ITEMS = ITEMS;
