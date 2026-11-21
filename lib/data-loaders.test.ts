import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * With cacheComponents, a page data loader that starts a database query before
 * `await connection()` breaks the production build ("unstable value Date.now()").
 * The local build doesn't always catch it, so this checks every loader.
 */
const FILES = ["lib/data.ts", "lib/crm-data.ts", "lib/inventory-data.ts", "lib/inventory-insights.ts", "lib/orders-data.ts", "lib/planning-data.ts", "lib/planning-insights.ts"];

describe("page data loaders", () => {
  it("every exported async loader starts with `await connection()`", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
      for (const m of src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s*([^\n]*)/g)) {
        if (!m[2].startsWith("await connection()")) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
