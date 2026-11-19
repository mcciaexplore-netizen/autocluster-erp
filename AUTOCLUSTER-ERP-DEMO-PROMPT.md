# Build Prompt: AutoCluster ERP Demo (Customers + Quotation Generator)

You are building a demo ERP web app for **ACDRI / AutoCluster, Pune** with two modules:

1. **Customers**: add and manage customer companies, the departments they work with, and the services they use.
2. **Quotation Generator**: pick a saved customer, add services with time / quantity, and produce a professional quotation PDF with the correct price automatically applied.

This is a demo for non-technical staff (front office, department coordinators). **Ease of use matters more than feature count.** Anyone should be able to create a customer and a quotation without training.

I develop on **Windows using PowerShell in the VS Code terminal**. Give every terminal command in PowerShell syntax.

---

## 1. Tech stack

- Next.js (latest stable, App Router) + TypeScript
- Tailwind CSS + shadcn/ui components
- lucide-react icons, sonner for toasts
- React Hook Form + Zod for forms and validation
- Neon Postgres + Drizzle ORM (connection string in `.env.local` as `DATABASE_URL`)
- Server Actions for create / update / delete
- @react-pdf/renderer for one-click quotation PDF download
- Deploy target: Vercel
- No login for the demo. Keep a single placeholder "Demo User" in the top bar.

---

## 2. Design system (light theme)

- Background: `#F7F8FA` (page), `#FFFFFF` (cards)
- Primary: navy `#0B1F3A` (buttons, headings, active nav)
- Success / confirm: green `#2E8B57`
- Highlight / attention: amber `#E8A33D` (badges like "MCCIA Member", pending states)
- Borders `#E5E7EB`, muted text `#6B7280`, error `#DC2626`
- Fonts: **Outfit** for all UI text, **DM Serif Display** only for page titles and the quotation PDF header (load via `next/font/google`)
- Base font size 16px, inputs and buttons at least 44px tall, rounded-xl cards, soft shadows, generous spacing
- Fully responsive: tables turn into cards on mobile
- Indian number formatting everywhere: `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` (e.g. ₹1,25,000.00)

### Layout
- Left sidebar: Home, Customers, Quotations, Rate Card, Settings. Collapses to a bottom bar / hamburger on mobile.
- Top bar: "ACDRI AutoCluster" logo placeholder (left), "Demo User" (right).

---

## 3. UX rules (follow strictly)

1. **Plain words only.** "Save customer", not "Submit". "Price type", not "pricing tier". "Add a service", not "Add line item". No technical terms anywhere in the UI.
2. **One main action per screen**, shown as a large navy button. Secondary actions are outline buttons.
3. **Step-by-step forms** with a visible progress bar ("Step 2 of 3: Department").
4. **Labels always visible above fields** (never placeholder-only). Every field has a short helper line with an example, e.g. "15 characters, e.g. 27AABCU9603R1ZM".
5. **Friendly inline errors** next to the field, shown when the user leaves the field, e.g. "This GST number looks too short. It should have 15 characters."
6. **Do the work for the user**: auto-uppercase GST / PAN / TAN, auto-fill PAN and state from the GST number, auto-calculate every amount live.
7. **Never lose work**: autosave unfinished forms to localStorage, and warn before leaving a page with unsaved changes.
8. **Always confirm results**: green toast after every save ("Customer saved"). Deleting asks for confirmation and offers "Undo" for 5 seconds (soft delete).
9. **Helpful empty states**: e.g. "No customers yet" with an "Add your first customer" button.
10. **Explain prices in words**: wherever a price is shown, show why, e.g. "MSME rate, less 10% MCCIA member discount".
11. Loading skeletons instead of spinners. Visible keyboard focus rings. WCAG AA contrast.

---

## 4. Master data

### 4.1 Departments

| Code | Full name | What it covers |
|---|---|---|
| RPT | Rapid Prototyping | 3D printing (SLA, SLS, Figure 4, Origin 1), charged per cc |
| PPF | Prototype Production Facility | CNC machining (5-axis, 3+1 axis), charged per hour |
| ENV | Environmental Testing | Thermal shock, water spray, dust, high-low, salt spray chambers |
| RPL | Rubber & Polymer Lab | UTM, FTIR, DSC, melt flow, ozone, oven, xenon, QUV |

Always show code and full name together, e.g. "RPT - Rapid Prototyping".

### 4.2 Services and rate card (seed exactly; effective 1 Nov 2025; rates in ₹)

| Dept | Service / machine | Charged | MSME rate | OEM / Tier 1-2 rate |
|---|---|---|---|---|
| RPT | SLA - imported resin | Per cc | 40 | 80 |
| RPT | SLA - local resin | Per cc | 25 | 40 |
| RPT | Figure 4 Standalone Pro, black | Per cc | 70 | 100 |
| RPT | SLS | Per cc | 30 | 40 |
| RPT | Origin 1 SLA | Per cc | 55 | 75 |
| PPF | 5-axis machining | Per hour | 1800 | 2000 |
| PPF | 3+1 axis machining | Per hour | 300 | 400 |
| ENV | Thermal shock chamber | Per hour | 190 | 220 |
| ENV | Water spray chamber | Per hour | 400 | 500 |
| ENV | Dust spray chamber | Per hour | 450 | 550 |
| ENV | High-low chamber | Per hour | 275 | 320 |
| ENV | Mini salt spray chamber | Per hour | 40 | 50 |
| RPL | UTM | Per sample | 1800 | 2100 |
| RPL | Ozone chamber | Per hour | 200 | 250 |
| RPL | Hot air oven | Per hour | 60 | 80 |
| RPL | FTIR | Per sample | 2500 | 3000 |
| RPL | Xenon test chamber | Per hour (up to 3 samples) | 80 | 120 |
| RPL | Melt flow index | Per sample | 1500 | 1800 |
| RPL | QUV Weather-Ometer | Per hour (up to 3 samples) | 80 | 100 |
| RPL | DSC | Per sample | 2700 | 3200 |

Unit types to store: `PER_CC`, `PER_HOUR`, `PER_SAMPLE`, `PER_HOUR_3_SAMPLES`.

### 4.3 Pricing rules (single source of truth: put this in one `lib/pricing.ts` file and unit test it)

1. **Price type** comes from the customer's company category:
   - Category = MSME → use **MSME rate**
   - Category = OEM, Tier 1 or Tier 2 → use **OEM / Tier 1-2 rate**
2. **MCCIA member discount**: if the customer is an MCCIA member, take **10% off** the rate chosen in step 1.
   - MSME + member → MSME rate less 10%
   - OEM / Tier 1 / Tier 2 + member → OEM rate less 10%
   - Discount % and "apply to non-MSME members too" (default ON) are editable in Settings.
3. Discount applies to rate-card services only. Custom items and lines where staff manually changed the rate are not discounted again (show a small "custom rate" tag on those lines).
4. Price-type label shown to users, e.g. "OEM / Tier 1-2 rate, less 10% MCCIA member discount".

---

## 5. Module 1: Customers

### 5.1 Customers list (`/customers`)
- Page title "Customers", large "+ Add new customer" button (top right).
- Search box: company name, contact person, phone, GST number.
- Filter chips: Department (RPT / PPF / ENV / RPL), Category (OEM / Tier 1 / Tier 2 / MSME), MCCIA member (Yes / No).
- Table columns: Company, Contact person, Phone, Category badge, "MCCIA Member" amber badge, Department chips, Actions (View, Edit, **Create quotation**).
- Mobile: each customer is a card with the same info.

### 5.2 "Add new customer" wizard (opens immediately on button click, as a full page `/customers/new`)

**Step 1 of 3: Company details**

| Field | Rules |
|---|---|
| Company name | Required |
| Company category | Required. Big radio cards: OEM / Tier 1 / Tier 2 / MSME. Helper: "This decides which rate applies." |
| Udyam registration no. | Optional, shown only if MSME |
| Address line 1, Address line 2 | Line 1 required |
| City, Pincode | Required. Pincode 6 digits |
| State | Dropdown of Indian states. Auto-filled from GST number |
| GST number (GSTIN) | Required unless "Not registered under GST" checkbox is ticked. Format `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`. Auto-uppercase. First 2 digits set the State. Characters 3-12 auto-fill PAN |
| PAN | Required. `^[A-Z]{5}[0-9]{4}[A-Z]$`. Warn (do not block) if it does not match the PAN inside the GST number |
| TAN | Optional. `^[A-Z]{4}[0-9]{5}[A-Z]$` |
| Contact person name | Required |
| Contact person designation | Optional |
| Mobile number | Required. 10 digits starting 6-9, shown with fixed "+91" prefix |
| Email | Required, valid email |
| **Is this company a member of MCCIA?** | Required. Two large radio buttons: Yes / No |
| MCCIA Membership ID | Appears with a smooth slide-down only when "Yes" is chosen. Required then |

Group the fields into three visual cards on the same step: "Company", "Contact person", "MCCIA membership". Button: **"Save and continue"** (saves the customer as a draft so nothing is lost).

**Step 2 of 3: Department**
- Prompt: "Which department(s) will this customer work with?"
- Four large selectable cards (icon, code, full name, one-line description from 4.1). Multiple selection allowed, at least one required.
- Buttons: "Back", **"Continue"**.

**Step 3 of 3: Services**
- Prompt: "Which services does this customer need?"
- Services grouped under each chosen department as checkbox cards.
- Each card shows: service name, how it is charged ("per cc"), and **this customer's price** computed live with the pricing rules, e.g. "Their price: ₹36 per cc (MSME rate, less 10% MCCIA member discount)". Show the list rate struck through when a discount applies.
- A sticky info strip at the top: "Price type for this customer: MSME rate + 10% MCCIA member discount".
- Buttons: "Back", **"Save customer"**.

**Success screen**
- Green check, "Sahyadri Auto Components saved".
- Two big buttons: **"Create a quotation for this customer"** (opens the quotation builder with this customer pre-selected) and "Back to customers".

### 5.3 Customer detail page (`/customers/[id]`)
- Summary card with all details, category badge, member badge, departments, services with their prices.
- Tabs: "Details", "Quotations" (this customer's quotations).
- Buttons: "Edit" (reopens the same wizard, pre-filled), "Create quotation", "Delete" (with confirm + undo).

---

## 6. Module 2: Quotation Generator

### 6.1 Quotations list (`/quotations`)
- Large "+ Create quotation" button.
- Search by quotation number or company. Filter by status and date range.
- Columns: Quotation no., Company, Date, Valid until, Total amount, Status chip (Draft / Sent / Accepted / Rejected), Actions (View, Download PDF, Duplicate, Change status).

### 6.2 Quotation builder (`/quotations/new`, also `/quotations/new?customer=ID`)

Desktop layout: left = the steps, right = a **sticky live summary card** (subtotal, discount, GST, grand total) that updates on every change. Mobile: summary collapses into a sticky bottom bar showing the grand total.

**Step 1: Choose customer**
- Searchable dropdown (type company name, contact person or GST no.). A small "+ Add new customer" link opens the customer wizard in a side panel and returns with the new customer selected.
- After selection, show a read-only customer card fetched from Module 1: company, address, GSTIN, PAN, contact person, phone, email, category, MCCIA membership ID. Include an "Edit customer" link.
- Show the price type badge, e.g. "Price type: MSME rate + 10% MCCIA member discount".

**Step 2: Add services**
- If the customer has saved services, show them first as quick-add chips: "Services this customer uses".
- "+ Add a service" opens a panel:
  1. Pick department (chips; the customer's saved departments first).
  2. Pick service / machine (list showing the customer's price and unit).
  3. Enter quantity. **The inputs change based on how the service is charged:**

| Unit type | Inputs shown | Billable quantity |
|---|---|---|
| PER_CC (3D printing) | "Volume per part (cc)" and "Number of parts" | volume x parts (cc) |
| PER_HOUR (machining, chambers) | "Machine hours" | hours |
| PER_SAMPLE (UTM, FTIR, DSC, MFI) | "Number of samples" | samples |
| PER_HOUR_3_SAMPLES (Xenon, QUV) | "Test hours" and "Number of samples" (helper: "One run holds up to 3 samples") | hours x ceil(samples / 3) |

  4. Optional "Notes for this service" (e.g. part name, test standard).
  5. Live preview inside the panel: "200 cc x ₹36 = ₹7,200". Button **"Add to quotation"**.
- Added services appear as an editable list: description, quantity breakdown in words ("50 cc x 4 parts = 200 cc"), rate, amount, Edit / Remove.
- A small "Change rate" link on each line lets staff override the rate (rates on the card are indicative). Overridden lines get a "custom rate" tag.
- "+ Add custom item" for extra operations not on the rate card: description, quantity, unit, rate.

**Step 3: Quotation details**
- Quotation number: auto, format `ACDRI/QT/2026-27/0001` (financial year April to March, running number per year, never reused).
- Quotation date (default today), Valid until (default today + 30 days, from Settings).
- Subject (default "Quotation for [department names] services").
- Notes to customer (optional).
- Terms and conditions: pre-filled from Settings, editable for this quotation.

**Step 4: Preview and save**
- A4 preview exactly as the PDF will look.
- Buttons: "Save as draft", **"Save and download PDF"**, "Print".

### 6.3 Calculations (all in `lib/pricing.ts`)
1. Line amount = billable quantity x final rate (rate after member discount where it applies).
2. Totals block:
   - Subtotal at list rates
   - Less: MCCIA member discount (10%)
   - Taxable value
   - GST at 18% (editable in Settings). If the customer's GST state code is **27 (Maharashtra)**, show CGST 9% + SGST 9%. Otherwise show IGST 18%. If the customer is not GST registered, use their selected state.
   - Round off (to the nearest rupee)
   - **Grand total**
   - Amount in words using the Indian system (lakh / crore), e.g. "Rupees Eight Thousand Four Hundred Ninety-Six Only".
3. Store all money as numeric with 2 decimals. Never use floating point for money math (use integer paise or a decimal library).

### 6.4 Quotation PDF
- Header: ACDRI AutoCluster logo placeholder, organisation name, address, GSTIN (from Settings), "QUOTATION" in DM Serif Display.
- Quotation no., date, valid until.
- "To" block: customer company, address, GSTIN, PAN, contact person, phone, email, MCCIA membership ID (if member).
- Subject line.
- Table: Sr no., Department, Service / description, Quantity (with breakdown), Unit, Rate, Amount.
- Totals block as in 6.3, amount in words.
- Terms and conditions, then "For ACDRI AutoCluster, Authorised Signatory".
- Footer: page number, "This is a computer-generated quotation."
- Clean, print-friendly, navy accents only, fits A4.

### 6.5 Important
- **Save a snapshot** of the customer details and every rate inside the quotation, so editing a customer or the rate card later never changes an old quotation.
- "Duplicate" creates a new draft with a new number and today's date.

---

## 7. Rate Card and Settings

### Rate Card page (`/rate-card`)
- Shows all services grouped by department with both rates, unit and effective date.
- "Edit rates" mode: inline edit, save with confirmation. Changes apply to new quotations only.
- Toggle "Active" per service (inactive services are hidden from forms).

### Settings page (`/settings`)
- Organisation profile: name, address, GSTIN, phone, email, logo upload (placeholder for now).
- MCCIA member discount % (default 10) and "Also apply to non-MSME members" (default ON).
- GST % (default 18), home state code (default 27, Maharashtra).
- Quotation validity in days (default 30), number prefix (default `ACDRI/QT`).
- Default terms and conditions (default text below).

Default terms:
1. Rates are standard charges for a standard test or job. Any extra operation will be charged separately.
2. Rates are as per the ACDRI rate card effective 1 November 2025 and are confirmed in this quotation.
3. GST will be charged as applicable.
4. This quotation is valid for 30 days from the date of issue.
5. Payment terms: [to be confirmed].

---

## 8. Database schema (Drizzle, Postgres)

- `departments` (code PK, name, description, sort_order)
- `services` (id, dept_code FK, name, unit_type, unit_label, rate_msme, rate_oem, effective_from, is_active, sort_order)
- `customers` (id, company_name, category [OEM | TIER1 | TIER2 | MSME], udyam_no, address_line1, address_line2, city, state, state_code, pincode, gst_registered bool, gstin, pan, tan, poc_name, poc_designation, poc_phone, poc_email, is_mccia_member bool, mccia_membership_id, status [DRAFT | ACTIVE], deleted_at, created_at, updated_at)
- `customer_departments` (customer_id, dept_code) composite PK
- `customer_services` (customer_id, service_id) composite PK
- `quotations` (id, quote_no unique, fy, seq, customer_id FK, customer_snapshot jsonb, price_type, member_discount_pct, subject, quote_date, valid_until, subtotal, discount_total, taxable_value, cgst, sgst, igst, round_off, grand_total, status [DRAFT | SENT | ACCEPTED | REJECTED], notes, terms, created_at, updated_at)
- `quotation_items` (id, quotation_id FK, sort_order, service_id nullable, dept_code, description, unit_type, hours, samples, cc_per_part, parts, billable_qty, list_rate, discount_pct, final_rate, is_custom_rate bool, amount, notes)
- `settings` (single row with all values from section 7)

Generate the quote number inside a transaction so two users never get the same number.

---

## 9. Demo seed data

Seed departments, all 20 services, settings, and 6 fictional customers covering every price case:

1. Sahyadri Auto Components Pvt Ltd, MSME, MCCIA member, Pune (GST state 27), departments RPT + PPF
2. Deccan Polymers LLP, MSME, not a member, Pune (27), RPL
3. Western Drive Systems Ltd, OEM, MCCIA member, Pune (27), ENV + RPL
4. Indus Forge Tier One Pvt Ltd, Tier 1, not a member, Bengaluru (GST state 29), PPF
5. Nashik Precision Tools, MSME, MCCIA member, Nashik (27), RPT
6. Kaveri Mobility Parts Pvt Ltd, Tier 2, MCCIA member, Chennai (GST state 33), ENV

Use valid-format (fake) GST / PAN / TAN numbers. Add 3 sample quotations in different statuses.

Provide `npm run db:push` and `npm run db:seed` scripts.

---

## 10. Build phases (finish and test each phase before the next)

1. **Setup**: project, Tailwind, shadcn/ui, fonts, theme, layout (sidebar, top bar), Neon + Drizzle, schema, seed. Home page with two big buttons ("Add new customer", "Create quotation") and 4 stat cards (Customers, Quotations this month, Total quoted this month, Pending quotations) plus "Recent quotations".
2. **Pricing logic**: `lib/pricing.ts` + unit tests (Vitest) for every case in section 11.
3. **Customers module**: list, wizard (3 steps + success screen), detail page, edit, soft delete with undo.
4. **Quotation Generator**: builder (4 steps + live summary), list, detail, duplicate, status change.
5. **PDF + Rate Card + Settings**.
6. **Polish**: empty states, skeletons, mobile check, keyboard navigation, unsaved-changes warning, final copy review for plain language. Write a short README with setup steps in PowerShell.

---

## 11. Done checklist (must all pass)

Pricing test cases (GST 18%):

| Customer | Service and quantity | Expected |
|---|---|---|
| MSME, member, Maharashtra | SLA imported resin, 50 cc x 4 parts = 200 cc | Subtotal ₹8,000, discount ₹800, taxable ₹7,200, CGST ₹648 + SGST ₹648, total **₹8,496** |
| OEM, not member, Karnataka (29) | 5-axis machining, 6 hours | Subtotal ₹12,000, no discount, IGST ₹2,160, total **₹14,160** |
| Tier 1, member, Maharashtra | UTM, 5 samples | Subtotal ₹10,500, discount ₹1,050, taxable ₹9,450, CGST ₹850.50 + SGST ₹850.50, total **₹11,151** |
| MSME, not member, Maharashtra | Xenon, 8 hours, 5 samples (2 runs) | 16 x ₹80 = ₹1,280, CGST ₹115.20 + SGST ₹115.20, total **₹1,510.40 → rounded ₹1,510** |

Flow checks:
- [ ] Clicking "Add new customer" opens the form immediately.
- [ ] Membership ID appears only when "Yes" is selected and is required then.
- [ ] Typing a GST number fills State and PAN automatically.
- [ ] Wrong GST / PAN / TAN / phone / email formats show a friendly message.
- [ ] Step 3 shows each service at the correct price for that customer.
- [ ] Selecting a customer in the quotation builder fills all their details.
- [ ] Quantity inputs change with the service type (cc / hours / samples).
- [ ] Totals update live; CGST + SGST for Maharashtra, IGST for other states.
- [ ] Quotation numbers are unique and follow `ACDRI/QT/2026-27/0001`.
- [ ] PDF downloads in one click and fits A4.
- [ ] Editing a rate or a customer does not change saved quotations.
- [ ] Works on a phone screen.
- [ ] No technical words anywhere in the UI.

---

## 12. Assumptions (list these in the README so I can confirm)

1. Department codes map as: RPT = Rapid Prototyping, PPF = Prototype Production Facility, ENV = Environmental Testing, RPL = Rubber & Polymer Lab.
2. "Company category" (OEM / Tier 1 / Tier 2 / MSME) is added to the customer form because the rate depends on it.
3. Member discount also applies to non-MSME members (on the OEM rate). The published rate card only mentions MSME members, so this is a Settings toggle.
4. GST is 18% (not stated on the rate card).
5. Xenon and QUV: one run holds up to 3 samples, charged per hour per run.
6. TAN is optional.
