import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, Outfit } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], display: "swap" });
const dmSerif = DM_Serif_Display({ variable: "--font-dm-serif", subsets: ["latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: { default: "AutoCluster", template: "%s | AutoCluster" },
  description: "Customers and quotations for AutoCluster, Pune",
  robots: { index: false, follow: false },
  applicationName: "ACDRI ERP",
  // iPhone / iPad "Add to Home Screen"
  appleWebApp: { capable: true, title: "ACDRI ERP", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

/** The light theme colour for the browser bar and the installed app. */
export const viewport: Viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${outfit.variable} ${dmSerif.variable} h-full antialiased`}>
      <body className="min-h-full bg-page font-sans text-foreground">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
