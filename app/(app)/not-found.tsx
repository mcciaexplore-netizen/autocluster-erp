import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="We couldn't find that page"
      description="It may have been deleted, or the link is not quite right."
      action={
        <Button asChild size="lg">
          <Link href="/">Go to Home</Link>
        </Button>
      }
    />
  );
}
