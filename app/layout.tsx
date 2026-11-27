import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, Outfit } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], display: "swap" });
const dmSerif = DM_Serif_Display({ variable: "--font-dm-serif", subsets: ["latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ERPOne", template: "%s · ERPOne" },
  description: "ERPOne: enquiries, quotations, orders, planning and stock in one place.",
  robots: { index: false, follow: false },
  applicationName: "ERPOne",
  // iPhone / iPad "Add to Home Screen"
  appleWebApp: { capable: true, title: "ERPOne", statusBarStyle: "default" },
  // favicon.ico (16, 32, 48) is picked up from app/; the SVG is sharper where browsers support it.
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
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
