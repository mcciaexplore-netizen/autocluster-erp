/**
 * The ERPOne product brand. The product name lives here only; the organisation using ERPOne
 * (Settings > Organisation profile) is shown separately and never replaced by it.
 */
import { cn } from "@/lib/utils";

export const PRODUCT_NAME = "ERPOne";
export const PRODUCT_TAGLINE = "Simple tools. Big results.";

/** "ERP" in navy, "One" in the logo's green-teal-blue gradient; Outfit 800. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans font-extrabold tracking-tight whitespace-nowrap", className)}>
      <span className="text-[#0B1F3A]">ERP</span>
      <span className="bg-linear-to-r from-[#2E8B57] via-[#14B8A6] to-[#3B82F6] bg-clip-text text-transparent">One</span>
    </span>
  );
}

/** The logo mark (for light backgrounds). Decorative: the wordmark beside it carries the name. */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    // An SVG file: next/image adds nothing here and the file loads before sign-in.
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/erpone-mark.svg" alt="" aria-hidden width={size} height={size} className={cn("shrink-0", className)} />
  );
}

/** Logo, name, tagline and "by MCCIA" above the sign-in and password cards. */
export function BrandHero() {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <LogoMark size={80} className="mb-3" />
      <h1>
        <Wordmark className="text-4xl md:text-5xl" />
      </h1>
      <p className="mt-2 text-muted-foreground">{PRODUCT_TAGLINE}</p>
      <p className="mt-1 text-xs tracking-wide text-muted-foreground/80">by MCCIA</p>
    </div>
  );
}
