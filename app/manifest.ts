import type { MetadataRoute } from "next";

/** "Add to Home Screen": opens full screen; on a shared shop-floor device it goes to the names (proxy.ts). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ACDRI ERP",
    short_name: "ACDRI ERP",
    description: "AutoCluster (ACDRI), Pune: enquiries, quotations, orders, planning and stock.",
    start_url: "/?source=home-screen",
    scope: "/",
    display: "standalone",
    display_override: ["fullscreen", "standalone"],
    background_color: "#F7F8FA",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
