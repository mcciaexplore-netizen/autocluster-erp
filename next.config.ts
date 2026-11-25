import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The PDF renderer runs on the server only (Node.js runtime). Its fonts are bundled in lib/pdf/fonts.generated.ts.
  serverExternalPackages: ["@react-pdf/renderer"],
  partialPrefetching: true,
  // forbidden(): the friendly no-access page (app/(app)/forbidden.tsx) instead of an error.
  experimental: { authInterrupts: true },
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
