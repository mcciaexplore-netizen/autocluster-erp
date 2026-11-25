"use client";

import { usePathname } from "next/navigation";
import { NoAccess } from "@/components/auth/no-access";
import { areaForPath } from "@/lib/areas";

/** Shown (inside the app's frame) when an area gate or a page's data says the person may not see it. */
export default function Forbidden() {
  return <NoAccess area={areaForPath(usePathname())} />;
}
