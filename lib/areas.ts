/**
 * The name of the area a page belongs to, for "You don't have access to Inventory." (most specific
 * first). Used by the no-access page (app/(app)/forbidden.tsx), which Next.js shows when forbidden()
 * is called by an area gate or a page's data loader.
 */
const AREAS: [RegExp, string][] = [
  [/^\/customers\/new/, "adding customers"],
  [/^\/customers\/[^/]+\/edit/, "changing customers"],
  [/^\/customers/, "Customers"],
  [/^\/settings\/activity/, "the Activity log"],
  [/^\/settings\/(users|roles)/, "Users and roles"],
  [/^\/settings/, "Settings"],
  [/^\/crm\/enquiries\/new/, "adding enquiries"],
  [/^\/crm\/enquiries\/[^/]+\/edit/, "changing enquiries"],
  [/^\/crm/, "CRM"],
  [/^\/planning\/insights/, "Planning Insights"],
  [/^\/planning\/machines\/new/, "adding machines"],
  [/^\/planning\/machines\/[^/]+\/edit/, "changing machines"],
  [/^\/planning/, "Planning"],
  [/^\/inventory\/insights/, "Inventory Insights"],
  [/^\/inventory\/movements\/new/, "recording stock"],
  [/^\/inventory\/items\/new/, "adding items"],
  [/^\/inventory\/items\/import/, "importing items"],
  [/^\/inventory\/items\/[^/]+\/edit/, "changing items"],
  [/^\/inventory\/suppliers\/new/, "adding suppliers"],
  [/^\/inventory\/suppliers\/[^/]+\/edit/, "changing suppliers"],
  [/^\/inventory/, "Inventory"],
  [/^\/quotations\/new/, "creating quotations"],
  [/^\/quotations\/[^/]+\/edit/, "changing quotations"],
  [/^\/quotations/, "Quotations"],
  [/^\/orders/, "Orders & Billing"],
  [/^\/rate-card/, "the Rate Card"],
];

export function areaForPath(pathname: string | null | undefined): string {
  return AREAS.find(([re]) => re.test(pathname ?? ""))?.[1] ?? "this page";
}
