import Link from "next/link";
import { StatusChip } from "@/components/common/badges";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { QuotationListRow } from "@/lib/data";
import { formatDate, money, todayIso } from "@/lib/format";
import { QuotationRowActions } from "./row-actions";

export function QuotationList({ rows, hideCompany }: { rows: QuotationListRow[]; hideCompany?: boolean }) {
  const today = todayIso();
  const expired = (r: QuotationListRow) => r.validUntil < today && (r.status === "DRAFT" || r.status === "SENT");
  return (
    <>
      <Card className="hidden py-0 lg:flex">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/60 hover:bg-secondary/60">
              <TableHead className="h-12 pl-5 text-sm">Quotation no.</TableHead>
              {hideCompany ? null : <TableHead className="text-sm">Company</TableHead>}
              <TableHead className="text-sm">Date</TableHead>
              <TableHead className="text-sm">Valid until</TableHead>
              <TableHead className="text-right text-sm">Total amount</TableHead>
              <TableHead className="text-sm">Status</TableHead>
              <TableHead className="pr-5 text-right text-sm">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((q) => (
              <TableRow key={q.id} className="text-base">
                <TableCell className="py-4 pl-5">
                  <Link href={`/quotations/${q.id}`} className="font-semibold text-primary tabular-nums hover:underline">
                    {q.quoteNo}
                  </Link>
                </TableCell>
                {hideCompany ? null : (
                  <TableCell className="max-w-72 whitespace-normal">
                    <Link href={`/customers/${q.customerId}`} className="hover:underline">
                      {q.companyName}
                    </Link>
                  </TableCell>
                )}
                <TableCell>{formatDate(q.quoteDate)}</TableCell>
                <TableCell>
                  {formatDate(q.validUntil)}
                  {expired(q) ? <span className="block text-sm text-destructive">Expired</span> : null}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(q.grandTotal)}</TableCell>
                <TableCell>
                  <StatusChip status={q.status} />
                </TableCell>
                <TableCell className="pr-5">
                  <QuotationRowActions id={q.id} quoteNo={q.quoteNo} status={q.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
        {rows.map((q) => (
          <li key={q.id}>
            <Card className="h-full gap-2 py-4">
              <div className="flex flex-col gap-2 px-5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/quotations/${q.id}`} className="font-semibold text-primary tabular-nums hover:underline">
                    {q.quoteNo}
                  </Link>
                  <StatusChip status={q.status} />
                </div>
                {hideCompany ? null : <div className="font-medium">{q.companyName}</div>}
                <div className="text-sm text-muted-foreground">
                  {formatDate(q.quoteDate)} · valid until {formatDate(q.validUntil)}
                  {expired(q) ? <span className="text-destructive"> (expired)</span> : null}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-semibold text-primary tabular-nums">{money(q.grandTotal)}</span>
                  <QuotationRowActions id={q.id} quoteNo={q.quoteNo} status={q.status} />
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
