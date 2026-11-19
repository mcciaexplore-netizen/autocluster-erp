/**
 * The billing export contract. Today the only version is a manual Excel download
 * (staff type the invoice into TallyPrime themselves). A TallyPrime version that
 * sends the voucher directly can be added later behind the same interface.
 */

export type ExportMethod = "EXCEL_MANUAL" | "TALLY";

export interface BillingLine {
  ticketNo: string;
  quoteNo: string;
  deptCode: string | null;
  description: string;
  /** e.g. "50 cc x 4 parts = 200 cc" */
  quantityText: string;
  billableQty: number;
  unitLabel: string;
  /** All money in integer paise. */
  listRatePaise: number;
  finalRatePaise: number;
  discountPct: number;
  listAmountPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

/** Everything needed to raise one tax invoice for one customer. */
export interface BillingDocument {
  customer: {
    companyName: string;
    gstin: string | null;
    address: string;
    state: string;
    stateCode: string;
    pocName: string;
    pocEmail: string;
    pocPhone: string;
  };
  pos: { number: string; date: string }[];
  quoteNos: string[];
  ticketNos: string[];
  ticketIds: string[];
  intraState: boolean;
  gstPct: number;
  lines: BillingLine[];
  totals: {
    listPaise: number;
    discountPaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    roundOffPaise: number;
    totalPaise: number;
  };
  preparedOn: string;
}

export type ExportResult =
  | { kind: "file"; fileName: string; mime: string; bytes: Uint8Array }
  | { kind: "sent"; reference: string };

export interface BillingExporter {
  method: ExportMethod;
  label: string;
  exportBilling(doc: BillingDocument): Promise<ExportResult>;
}
