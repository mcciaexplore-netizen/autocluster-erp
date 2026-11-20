# Build Prompt: AutoCluster ERP Module 5 (Inventory)

The AutoCluster ERP has CRM, Customers, Quotations and Orders & Billing working, live on Vercel with Neon. Now add **Inventory**: track raw materials and consumables, record what each job uses, know what to reorder before it runs out, and see the numbers needed for decisions (what materials cost per job, how much each service keeps after materials, where money is locked in stock, which prices are rising).

Model it on the standard stock flow in **Odoo Inventory** and **Zoho Inventory**, simplified for non-technical lab and store staff.

Same rules as before:
- Windows, PowerShell syntax for every command.
- Same stack, design system, plain-language UX rules, money rules (integer paise, Indian formatting), file storage (Vercel Blob with environment folders) and auto-refresh rules.
- When a step needs me, stop, give me short numbered steps in plain words, and wait for "done".
- Never print secrets in the chat or commit them.
- Work on a new `module5-inventory` branch. Run a local production build before every push, and commit and push after every phase.
- Test locally and on the Preview copy first. Live changes only in the last phase.

---

## 1. Plain words (use these in the UI, never the jargon)

| Don't say | Say |
|---|---|
| SKU | Item code |
| UoM | Unit |
| GRN / goods receipt | Stock received |
| Goods issue | Stock used / Stock issued |
| FEFO | "Uses the batch that expires first" |
| ABC analysis | Biggest-spend items |
| Stock valuation | Stock value |
| Physical verification | Stock count |

---

## 2. Where it goes

- New sidebar item **"Inventory"** between Orders & Billing and Rate Card. Use the lucide `Package` icon. The same position on phones.
- Pages, shown as tabs at the top of the Inventory section (on phones the tab strip scrolls inside its own box, and the page never scrolls sideways):
  - `/inventory` **Overview**
  - `/inventory/items` **Items**
  - `/inventory/movements` **Stock in & out**
  - `/inventory/counts` **Stock count**
  - `/inventory/reorder` **Reorder list**
  - `/inventory/suppliers` **Suppliers**
  - `/inventory/insights` **Insights**
- Three big quick-action buttons on the Overview, and also in the Items page header: **"Stock received"**, **"Use stock"**, **"Adjust stock"**.

---

## 3. Items

### 3.1 Items list (`/inventory/items`)
- "+ Add item" button.
- Search: name, item code.
- Filters:
  - Category
  - Department
  - Stock status: In stock / Low / Out of stock / Expiring soon
  - "Has batches"
  - Show inactive
- Columns:
  - Item code, Name, Category, Department chips
  - **Stock** (quantity + unit)
  - Status chip: green "In stock", amber "Low", red "Out of stock", purple "Expiring soon"
  - Stock value, Reorder level
  - **"Runs out in"** (e.g. "~12 days")
- Phone: cards with the same information.

### 3.2 Item form

| Field | Rules |
|---|---|
| Item name | Required, e.g. "SLA resin, imported (grey)" |
| Item code | Auto: `ITM-0001`, editable, unique |
| Category | Required. From Settings: Raw material, Consumable, Lab chemical, Spare part, Tool |
| Department(s) | Chips: RPT / PPF / ENV / RPL |
| Unit | Required. From Settings: ml, L, g, kg, pcs, m, set, cylinder, box |
| Pack | Optional, e.g. "Bottle" of size 1000 (ml). Lets staff receive stock as "3 bottles" instead of "3000 ml" |
| Reorder level | Required. "Warn me when stock falls to this" |
| Reorder quantity | Required. "How much I usually order" |
| Supplier lead time (days) | Optional. "How many days the supplier takes to deliver" |
| Preferred supplier | Optional, from Suppliers |
| Where it's kept | Optional text, e.g. "RPT lab, rack 2" |
| Track batches and expiry | Switch. Turn on for resins, powders and chemicals |
| HSN code | Optional |
| Notes | Optional |
| Active | Switch. Inactive items are hidden from forms, but their history stays |

Quantities allow up to 3 decimals. Unit costs allow up to 4 decimals (some consumables cost a few paise per ml). Totals are rounded to the paisa. Use a decimal library, never floating point.

### 3.3 Item detail (`/inventory/items/[id]`)
- **Top section:**
  - Current stock, stock value, average cost per unit, status chip
  - "Runs out in ~X days"
  - Reorder level and quantity
  - Buttons: "Stock received", "Use stock", "Adjust stock", "Print label", Edit
- **Batches** (if tracked): batch no., quantity left, expiry date, an "Expires in X days" chip, and "Expired" in red.
- **Stock history:** every movement, newest first, with date, type, quantity in or out, **running balance**, value, linked ticket or supplier bill, who did it and the note. "Download as Excel".
- **Usage chart:** quantity used per month for the last 12 months.
- **Suppliers and prices:** each supplier's last rate and date, plus a price history chart.
- **Used by services:** which rate-card services use this item, and how much per unit (section 6.1).

---

## 4. Suppliers (`/inventory/suppliers`)

- List with search.
- Supplier form:
  - Name (required), contact person, mobile, email, GSTIN (same format checks as customers), address, notes, active.
- Supplier detail:
  - Items they supply, with last rate and lead time
  - All stock received from them
  - Total bought this financial year

---

## 5. Stock in and out (every change to stock is a movement; stock is never typed in directly)

Each save creates one numbered record with one or more lines. Numbering works like quotation numbers (inside a transaction, by financial year):

| Record | Number | Covers |
|---|---|---|
| Stock received | `ACDRI/IN/2026-27/0001` | Stock arriving from a supplier |
| Stock used | `ACDRI/OUT/2026-27/0001` | Stock used for a job, or for internal use |
| Stock adjusted | `ACDRI/ADJ/2026-27/0001` | Corrections, damage, expiry, stock counts |

**"Done by"** on every record: a dropdown of team members (the same list as the CRM, from Settings). It remembers the last choice on that device.

### 5.1 Stock received
- Header:
  - Supplier (searchable, with "+ Add new supplier")
  - Supplier bill no. and bill date
  - Upload the bill (optional; PDF / JPG / PNG, up to 10 MB, in Vercel Blob)
  - Done by, note
- Lines:
  - Item
  - Quantity, entered either in units or in packs ("3 bottles of 1000 ml = 3,000 ml")
  - **Rate before GST**, per unit or per pack (helper: "Enter the rate without GST")
  - Batch no. and expiry date (required only if the item tracks batches)
  - Line total
- On save:
  - Stock goes up.
  - The item's **average cost** is recalculated (weighted average, section 9).
  - The supplier's last rate for that item is updated.
  - Any "Ordered" marker for the item from this supplier is cleared (section 8).

### 5.2 Use stock
- **"What is this for?"**, shown as two big cards:
  1. **For a job:**
     - Pick the ticket: search by ticket no., company or service.
     - The app **suggests the materials** from that service's materials list × the ticket's billable quantity (section 6), e.g. "200 cc × 1.15 ml per cc = 230 ml SLA resin".
     - Staff confirm or change each quantity, and can add or remove lines.
  2. **Internal use:** purpose from Settings: Machine maintenance, Trial run, Training, R&D, Other. A note is required for Other.
- Lines:
  - Item and quantity. Show "In stock: 1,450 ml" next to each line.
  - **Batch:** picked automatically, using the batch that expires first. Staff can change it. Expired batches are not offered; show "1 expired batch, adjust it out instead".
- **Not enough stock:** block saving and show a plain message, e.g. "Only 150 ml of SLA resin in stock. You entered 230 ml."
- On save, stock goes down at the current average cost. The value is saved on each line, so job costs never change later.

### 5.3 Adjust stock
- Lines: item, batch (if tracked), **"Add" or "Remove"**, quantity, reason.
- Reasons, from Settings: Damaged, Expired, Spilled / wasted, Found extra, Correction, Other. A note is required.
- Removing expired stock is the normal way to write off expired batches.

### 5.4 Stock in & out page (`/inventory/movements`)
- All records, newest first.
- Filters: type, item, supplier, ticket, done by, date range.
- Open any record to see its lines, value and attached bill.
- **Mistakes:** records are never edited or deleted. A "Reverse" button creates an opposite record linked to the original, with a reason, and both appear in history. Explain in one line: "To fix a mistake, reverse it and enter it again."
- "Download as Excel" respects the filters.

---

## 6. Links to jobs and pricing

### 6.1 Materials per service (Rate Card page)
- Each service on the Rate Card gets a "Materials used" button.
- Staff list the items that service uses and **how much per billing unit**. Examples:
  - SLA imported resin: 1.15 ml resin per cc (covers supports and waste), 0.05 ml IPA per cc
  - 5-axis machining: 0.2 L coolant per hour
  - Mini salt spray: 5 g salt per hour
- These are only used for suggestions. Actual use is always confirmed by staff.

### 6.2 Ticket (Orders & Billing)
- The ticket side panel gets a **"Materials used"** section:
  - The lines issued for this ticket
  - Total material cost
  - **"Kept after materials"** = ticket value before GST minus material cost, as ₹ and %
  - A "Record materials" button that opens "Use stock" with this ticket chosen and the suggestions filled in
- The Orders board gets a filter: "Materials not recorded".
- **Paid column:** show only tickets paid in the last 30 days by default, with a "Show older paid" link. The demo history (section 12) adds many paid jobs, and this column must stay usable.

### 6.3 Stock hints (never block anything)
- **Quotation builder:** for a service with a materials list, show a small hint under the line: green "Enough stock", or amber "Low stock: SLA resin (needs ~230 ml, 150 ml in stock)".
- **Ticket panel:** the same hint while materials haven't been recorded.

---

## 7. Stock count (`/inventory/counts`)

1. **"Start a stock count":** all items, or filter by category or department.
   - The app freezes each item's system quantity at the start.
2. **Count screen:** made for a phone in the store. One item per row, a big number box, and batches listed separately if tracked.
   - Progress: "18 of 25 counted".
   - Saves as you go; staff can leave and come back.
3. **Review:**
   - Only items with differences, showing system quantity, counted quantity, difference and value of the difference.
   - Total gain / loss.
4. **"Complete count":** creates one Stock adjusted record with reason "Stock count dd/mm/yyyy". The count is then locked.
5. **Movements during a count:** warn on the count screen. Count against the frozen quantity plus or minus movements since the start, and explain this in one line.

---

## 8. Reorder list (`/inventory/reorder`)

- **An item appears when either:**
  - stock is at or below its reorder level, or
  - it will run out before new stock can arrive ("Runs out in" ≤ lead time + safety days, from Settings).
- Grouped by preferred supplier. For each item:
  - Current stock, "Runs out in"
  - Suggested quantity (the reorder quantity, shown in packs where set), editable
  - Last rate, estimated cost
- Tick items, then **"Send to supplier"**:
  - **WhatsApp:** `wa.me` to the supplier's mobile with a ready-written list of items and quantities.
  - **Email:** `mailto:` with the same list.
  - **Download:** PDF or Excel order list, with ACDRI's details from Settings.
- Sending marks each item **"Ordered on 20 Nov"**, so nobody orders twice. The marker clears when stock of that item is received from that supplier, or by hand.
- This is not a full supplier purchase-order system yet. Keep a short note in the README.

---

## 9. Calculations (put them all in `lib/inventory/` and unit test them)

1. **Weighted average cost.** On every receipt:
   - new average = (current qty × current average + received qty × received rate) ÷ (current qty + received qty)
   - Stock used and removed is valued at the average at that moment.
   - Stock value = qty × average cost.
2. **Average daily use** = quantity used (for jobs + internal use, not adjustments) in the last N days (Settings, default 90) ÷ N.
3. **Runs out in** = current qty ÷ average daily use.
   - Show "No recent use" when there was no use.
   - Show "Out of stock" at 0.
4. **Order now** when qty ≤ reorder level, or Runs out in ≤ lead time + safety days (Settings, default 7).
5. **Material cost of a job** = the sum of the saved values of all stock used for that ticket, minus any reversals.
6. **Kept after materials** = ticket value before GST − material cost, as ₹ and %.
7. **Slow-moving** = in stock but no use for 90 days. **Not used at all** = no use for 180 days. Show the value tied up in each.
8. **Biggest-spend items** = items ranked by value used in the last 12 months, with a running % so it's clear which few items make up most of the spend.
9. **Price change** = the last purchase rate compared with the rate about 6 months earlier, as %. Flag rises above 10% (Settings).
10. **Locking:** every save that changes stock locks the affected item rows (`SELECT ... FOR UPDATE`) inside one transaction, so stock can never go below zero, even when two people save at the same moment.
11. **Fast reads:** keep current quantity and average cost on the item and batch rows, updated in the same transaction as the movement.
    - Add `npm run inv:verify`: it recalculates everything from the movements and reports any difference in plain words. It must report none after seeding and after the tests.

---

## 10. Overview and Insights

### 10.1 Overview (`/inventory`) for day-to-day work
- **Cards** (each opens the matching filter):
  - Stock value
  - Items to reorder
  - Out of stock
  - Expiring in 30 days
- **"Needs attention":** short lists of items to reorder, batches expiring soon, expired batches still in stock, and tickets in Billing or later with no materials recorded.
- **Recent stock in & out** (last 10).

### 10.2 Insights (`/inventory/insights`) for decisions
- Date range picker. Default: this financial year.
- Department filter.
- Each chart or table gets a one-line plain explanation of what it shows and why it matters.

| Section | Shows |
|---|---|
| Material spend by month | Value used per month, by department (stacked bars) |
| Kept after materials, by service | For each service: jobs done, revenue before GST, material cost, kept ₹ and %. Lowest % first. Flag services where materials take more than 40% (Settings) |
| Biggest-spend items | Top 10 by value used, with the running % |
| Price changes | Items whose purchase rate rose more than 10%, the old and new rate, and which services use them. Plain line: "SLA resin costs 18% more than in May. SLA imported jobs now keep 52% after materials, down from 61%. Consider reviewing the rate card." |
| Money tied up in stock | Stock value by category and department, plus slow-moving and unused items with their value |
| Expiry losses | Value written off as expired, by month and item |
| Running out soon | Items by "Runs out in", compared with supplier lead time |

- Use the app's existing chart approach. If there isn't one, use Recharts with the app's colours.
- Light theme, readable on phones, no sideways scrolling.
- "Download as Excel" on every table.

### 10.3 Home page
Add 2 cards after the existing ones: "Items to reorder" and "Expiring in 30 days". Each opens the matching inventory filter.

---

## 11. QR labels

- "Print label" on an item and on a batch gives an A4 sheet of labels: item name, code, unit, batch and expiry if any, and a **QR code linking to the item page**.
- Staff scan it with their phone camera. It opens the item page (after sign-in), where the big "Use stock" button is right at the top.
- No in-app scanner is needed.

---

## 12. Settings (new "Inventory" section)

Editable lists (add, rename, reorder, hide when in use):
- Categories
- Units
- Internal use purposes
- Adjustment reasons

Values:
- Number prefixes (`ACDRI/IN`, `ACDRI/OUT`, `ACDRI/ADJ`, item code prefix `ITM`)
- Expiry warning days (30)
- Days used for average use (90)
- Safety days (7)
- Price rise alert % (10)
- High material share alert % (40)
- WhatsApp and email templates for supplier orders

---

## 13. Database (additive only; live data must not be lost)

- `inv_categories`, `inv_units`, `inv_purposes`, `inv_adjust_reasons`: id, name, sort_order, is_active
- `inv_items`:
  - id, code (unique), name, category_id, unit_id
  - pack_name, pack_size
  - reorder_level, reorder_qty, lead_time_days
  - preferred_supplier_id, storage_place
  - track_batches, hsn_code, notes, is_active
  - qty_on_hand, avg_cost
  - last_purchase_rate, ordered_on, ordered_supplier_id
  - created_at, updated_at
- `inv_item_departments` (item_id, dept_code)
- `inv_suppliers`: id, name, contact_name, phone, email, gstin, address, notes, is_active, created_at
- `inv_supplier_items`: supplier_id, item_id, last_rate, last_rate_date, lead_time_days
- `inv_batches`: id, item_id, batch_no, expiry_date, qty_on_hand, received_on (unique on item + batch no.)
- `inv_documents`:
  - id, doc_no (unique), fy, seq, type [IN | OUT | ADJ], doc_date
  - supplier_id, supplier_bill_no, supplier_bill_date, file_id
  - ticket_id, purpose_id
  - reverses_doc_id, reversed_by_doc_id
  - done_by (team_member_id), note, created_at
- `inv_movements`:
  - id, document_id, item_id, batch_id
  - qty_in, qty_out, unit_cost, value
  - reason_id, note
  - balance_after, created_at
- `inv_service_materials`: service_id, item_id, qty_per_unit
- `inv_counts`: id, count_no, status [IN_PROGRESS | COMPLETED], filter (jsonb), started_at, completed_at, adjustment_doc_id, done_by
- `inv_count_lines`: id, count_id, item_id, batch_id, system_qty, counted_qty, counted_at
- `inv_reorder_sends`: id, supplier_id, items (jsonb), method, created_at, done_by
- `settings`: add the inventory values from section 12.

Quantities: `numeric(14,3)`. Unit costs: `numeric(14,4)` in rupees. Values: integer paise.

---

## 14. Demo data (6 months of history, so Insights shows real patterns)

Add to `db:seed` / `db:reset`, keeping all existing demo stories working:

- **4 fictional suppliers:** e.g. Deccan Resins & Polymers, Pune Metal Stockists, LabChem Supplies Pune, Precision Tools Mart.
- **About 25 items** across departments, with realistic units, packs and reorder levels:
  - **RPT:** imported SLA resin (grey), local SLA resin, Figure 4 black resin, SLS nylon powder, Origin 1 resin, IPA for cleaning, build plate film, nitrile gloves
  - **PPF:** aluminium 6061 blocks, mild steel bar, Delrin rod, 10 mm and 6 mm carbide end mills, coolant
  - **ENV:** salt spray grade sodium chloride, distilled water, test chamber filters
  - **RPL:** DSC aluminium pans, nitrogen gas cylinder, xenon lamp, QUV lamps, FTIR cleaning wipes, UTM grip inserts
- **Materials lists** for every rate-card service where it makes sense.
- **About 40 past jobs from the last 6 months:**
  - Accepted quotations → tickets → invoices → paid, using existing and a few new fictional customers, dated across the months.
  - Each with materials recorded at the suggested quantity × a realistic variation (0.95 to 1.25).
  - Plus regular internal use.
  - Create these before the current demo records, so the story quotations and tickets come last.
  - **Tell me the new numbers** for the demo story quotations (Sahyadri SLA, Western Drive) in the final summary.
- **Situations to include:**
  - 3 items below reorder level and 1 out of stock (one of them already "Ordered on")
  - 2 batches expiring within 30 days and 1 expired batch still in stock
  - 2 slow-moving items
  - **SLA imported resin price rising about 18% since May**, so the Price changes and Kept-after-materials sections show the story in 10.2
  - One completed stock count with small differences
- Use a fixed random seed so the data is the same on every reset. Receipts must always come before use, so stock never goes negative.
- `npm run inv:verify` must report no differences after seeding.

---

## 15. Build phases (commit and push to `module5-inventory` after each)

1. **Database, settings lists, items and suppliers:** forms, lists, item detail shell.
2. **Stock engine:** Stock received (packs, batches, bill upload), Use stock (internal), Adjust stock, reversals, average cost, locking, batches that expire first, item history with running balance, `inv:verify`.
3. **Jobs:** materials per service on the Rate Card, Use stock for a job with suggestions, ticket "Materials used" and "Kept after materials", "Materials not recorded" filter, Paid column showing the last 30 days, stock hints in the quotation builder and ticket panel.
4. **Stock count.**
5. **Reorder list:** grouping, send to supplier (WhatsApp, email, PDF, Excel), "Ordered on" markers.
6. **Overview, Insights, home cards and QR labels.**
7. **Demo data, tests and go live:**
   - Test on the Preview copy.
   - Back up live.
   - Add the new tables to live.
   - Run `db:reset` on live (full demo); no need to ask.
   - Merge to `main`, check the live site, run `db:reset` on live again so the demo starts clean, and confirm `main` and the branch match.

---

## 16. Done checklist

Tests (Vitest):
- [ ] **Average cost:** receive 1,000 ml at ₹4.00 and 1,000 ml at ₹5.00 → average ₹4.50. Use 500 ml → value ₹2,250, leaving 1,500 ml at ₹4.50.
- [ ] **Packs:** receive 3 bottles of 1,000 ml at ₹4,500 per bottle → 3,000 ml at ₹4.50 per ml.
- [ ] **Suggestions:** a 200 cc SLA imported ticket with 1.15 ml per cc suggests 230 ml. At ₹4.50 per ml, material cost is ₹1,035, and a ticket value of ₹7,200 keeps ₹6,165 (85.6%).
- [ ] **No negative stock:** using more than in stock is refused. 10 uses of the same item saved at the same moment never take stock below zero.
- [ ] **Batches:** use picks the batch that expires first. Expired batches are not offered.
- [ ] **Runs out in:** 600 ml in stock with 1,800 ml used in the last 90 days → 20 ml a day → 30 days. With a lead time of 21 and 7 safety days, it is not on the reorder list. At 500 ml (25 days) it is.
- [ ] **Reversal:** a reversal restores stock and value exactly. A reversed record can't be reversed again.
- [ ] **Stock count:** completing a count creates the right adjustments and locks the count.
- [ ] **Ordered markers:** they clear when stock is received from that supplier.
- [ ] **Price change and slow-moving:** both calculations are correct, using India time.
- [ ] **Verify:** `inv:verify` reports no differences after seeding and after all tests.

Browser checks:
- [ ] Inventory sits between Orders & Billing and Rate Card, on desktop and phone.
- [ ] Receive 3 bottles of resin with a batch and expiry, and upload a bill. Stock, average cost and history update.
- [ ] Record materials on a ticket from its panel. The suggestions appear, and "Kept after materials" shows.
- [ ] Try to use more stock than available. A plain message appears and nothing saves.
- [ ] Do a stock count on a phone-width screen and complete it.
- [ ] Send a reorder list by WhatsApp. It opens with the filled-in list, and the items show "Ordered on".
- [ ] Insights shows the SLA resin price story in Price changes and Kept after materials.
- [ ] Scan a printed QR label with a phone. It opens the item page.
- [ ] No page scrolls sideways at phone width, and there are no technical words in the UI.

---

## 17. Final summary for me

In plain words, tell me:
1. What's new and where to find it.
2. The demo story to show (with the new quotation and ticket numbers).
3. Anything that didn't pass or that you had to work around.
4. Any assumptions I should confirm.
