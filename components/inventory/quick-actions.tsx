import { PackageMinus, PackagePlus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The three big buttons: Stock received, Use stock, Adjust stock (optionally for one item). */
export function QuickActions({ itemId, big = false, className }: { itemId?: string; big?: boolean; className?: string }) {
  const q = itemId ? `&item=${itemId}` : "";
  const size = big ? "lg" : "default";
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button asChild size={size}>
        <Link href={`/inventory/movements/new?type=in${q}`}>
          <PackagePlus aria-hidden /> Stock received
        </Link>
      </Button>
      <Button asChild size={size} variant="outline">
        <Link href={`/inventory/movements/new?type=out${q}`}>
          <PackageMinus aria-hidden /> Use stock
        </Link>
      </Button>
      <Button asChild size={size} variant="outline">
        <Link href={`/inventory/movements/new?type=adj${q}`}>
          <SlidersHorizontal aria-hidden /> Adjust stock
        </Link>
      </Button>
    </div>
  );
}
