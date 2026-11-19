"use client";

import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error(error);
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong"
      description="Your work in forms is kept on this device. Please try again. If it keeps happening, check the internet connection."
      action={
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
