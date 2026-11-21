import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Eye, FilePlus2, Pencil, Phone, Plus, SearchX, Users } from "lucide-react";
import { CategoryBadge, DeptChip, MemberBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { ChipGroup, ClearFilters, SearchBox } from "@/components/common/filter-bar";
import { ListSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDepartments, listCustomers } from "@/lib/data";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Companies that use AutoCluster services."
        actions={
          <Button asChild size="lg">
            <Link href="/customers/new">
              <Plus aria-hidden /> Add new customer
            </Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-4">
        <Suspense>
          <SearchBox label="Search customers" placeholder="Search by company, contact person, phone or GST number" />
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
            <DeptChips />
            <ChipGroup
              label="Category"
              name="category"
              options={[
                { value: "OEM", label: "OEM" },
                { value: "TIER1", label: "Tier 1" },
                { value: "TIER2", label: "Tier 2" },
                { value: "MSME", label: "MSME" },
              ]}
            />
            <ChipGroup
              label="MCCIA member"
              name="member"
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
            <ClearFilters keys={["q", "dept", "category", "member"]} />
          </div>
        </Suspense>
      </div>

      <Suspense fallback={<ListSkeleton />}>
        <CustomerResults searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Department filter: every department in the table. */
async function DeptChips() {
  const depts = await getDepartments();
  return <ChipGroup label="Department" name="dept" options={depts.map((d) => ({ value: d.code, label: d.code }))} />;
}

async function CustomerResults({ searchParams }: { searchParams: PageProps<"/customers">["searchParams"] }) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const filters = { q: str(sp.q), dept: str(sp.dept), category: str(sp.category), member: str(sp.member) };
  const rows = await listCustomers(filters);
  const filtered = Object.values(filters).some(Boolean);

  if (!rows.length) {
    return filtered ? (
      <EmptyState icon={SearchX} title="No customers match" description="Try a different search, or clear the filters." />
    ) : (
      <EmptyState
        icon={Users}
        title="No customers yet"
        description="Add a company once, and its details fill in on every quotation."
        action={
          <Button asChild size="lg">
            <Link href="/customers/new">
              <Plus aria-hidden /> Add your first customer
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        Showing {rows.length} {rows.length === 1 ? "customer" : "customers"}
      </p>

      {/* Desktop table */}
      <Card className="hidden py-0 lg:flex">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/60 hover:bg-secondary/60">
              <TableHead className="h-12 pl-5 text-sm">Company</TableHead>
              <TableHead className="text-sm">Contact person</TableHead>
              <TableHead className="text-sm">Phone</TableHead>
              <TableHead className="text-sm">Category</TableHead>
              <TableHead className="text-sm">Departments</TableHead>
              <TableHead className="pr-5 text-right text-sm">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} className="text-base">
                <TableCell className="py-4 pl-5 whitespace-normal">
                  <Link href={`/customers/${c.id}`} className="font-semibold text-primary hover:underline">
                    {c.companyName}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {c.city}
                    {c.isMcciaMember ? <MemberBadge /> : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">{c.pocName}</TableCell>
                <TableCell className="tabular-nums">+91 {c.pocPhone}</TableCell>
                <TableCell>
                  <CategoryBadge category={c.category} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {c.deptCodes.map((d) => (
                      <DeptChip key={d} code={d} />
                    ))}
                  </div>
                </TableCell>
                <TableCell className="pr-5">
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="icon-sm" aria-label={`View ${c.companyName}`}>
                      <Link href={`/customers/${c.id}`}>
                        <Eye />
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="icon-sm" aria-label={`Edit ${c.companyName}`}>
                      <Link href={`/customers/${c.id}/edit`}>
                        <Pencil />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/quotations/new?customer=${c.id}`}>
                        <FilePlus2 aria-hidden /> Create quotation
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile and tablet cards */}
      <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
        {rows.map((c) => (
          <li key={c.id}>
            <Card className="h-full gap-3 py-5">
              <div className="flex flex-col gap-3 px-5">
                <div>
                  <Link href={`/customers/${c.id}`} className="text-lg font-semibold text-primary hover:underline">
                    {c.companyName}
                  </Link>
                  <p className="text-sm text-muted-foreground">{c.city}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CategoryBadge category={c.category} />
                  {c.isMcciaMember ? <MemberBadge /> : null}
                  {c.deptCodes.map((d) => (
                    <DeptChip key={d} code={d} />
                  ))}
                </div>
                <div className="text-sm">
                  <div className="font-medium">{c.pocName}</div>
                  <a href={`tel:+91${c.pocPhone}`} className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="size-4" aria-hidden /> +91 {c.pocPhone}
                  </a>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/customers/${c.id}`}>View</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/customers/${c.id}/edit`}>Edit</Link>
                  </Button>
                  <Button asChild className="col-span-2">
                    <Link href={`/quotations/new?customer=${c.id}`}>
                      <FilePlus2 aria-hidden /> Create quotation
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
