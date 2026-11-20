"use client";

import { Download, FileSpreadsheet, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ImportDialog } from "./import-dialog";
import { useCrmFilters } from "./use-crm-filters";

/** The board's (and list's) "..." menu: Import enquiries, and Download as Excel. */
export function CrmMoreMenu() {
  const [importing, setImporting] = useState(false);
  const { query } = useCrmFilters();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More: import and download">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem className="h-10" onSelect={() => setImporting(true)}>
            <FileSpreadsheet /> Import enquiries
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10" asChild>
            <a href={`/api/crm/export${query}`} download data-skip-unsaved>
              <Download /> Download as Excel
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}

/** List view: a visible "Download as Excel" button that keeps the current filters and sort. */
export function DownloadExcelButton() {
  const { query } = useCrmFilters();
  return (
    <Button asChild variant="outline">
      <a href={`/api/crm/export${query}`} download data-skip-unsaved>
        <Download aria-hidden /> <span className="hidden sm:inline">Download as Excel</span>
        <span className="sm:hidden">Excel</span>
      </a>
    </Button>
  );
}
