import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * With cacheComponents, a page data loader that starts a database query before
 * `await connection()` breaks the production build ("unstable value Date.now()").
 * The local build doesn't always catch it, so this checks every loader.
 */
const FILES = ["lib/data.ts", "lib/crm-data.ts", "lib/inventory-data.ts", "lib/inventory-insights.ts", "lib/orders-data.ts", "lib/planning-data.ts", "lib/planning-insights.ts", "lib/profile-data.ts", "lib/admin-data.ts", "lib/users-data.ts"];

/** Each exported async loader with the first two statements of its body. */
function loaders(file: string) {
  const src = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  return [...src.matchAll(/export async function (\w+)\(/g)].map((m) => {
    // The body starts at the first "{" that ends a line after the signature.
    const open = src.indexOf("{\n", src.indexOf(")", m.index!));
    const lines = src.slice(open + 2).split("\n").map((l) => l.trim()).filter(Boolean);
    return { name: m[1], first: lines[0] ?? "", second: lines[1] ?? "" };
  });
}

describe("page data loaders", () => {
  it("every exported async loader starts with `await connection()`", () => {
    const missing = FILES.flatMap((f) => loaders(f).filter((l) => l.first !== "await connection();").map((l) => `${f}: ${l.name}`));
    expect(missing).toEqual([]);
  });

  it("every exported async loader checks who is asking (need(...)) right after that", () => {
    const missing = FILES.flatMap((f) => loaders(f).filter((l) => !/^(const \w+ = )?await need\(/.test(l.second)).map((l) => `${f}: ${l.name}`));
    expect(missing).toEqual([]);
  });
});
