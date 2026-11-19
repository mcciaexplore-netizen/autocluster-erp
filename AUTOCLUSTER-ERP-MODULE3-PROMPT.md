# Build Prompt: AutoCluster ERP Module 3 (Orders & Billing Kanban)

The AutoCluster ERP demo already has **Customers** and **Quotation Generator** working, live on Vercel with Neon. Now add **Module 3: Orders & Billing**, a Kanban board that tracks every accepted service from PO to payment.

Same rules as before:
- Windows, PowerShell syntax for every command.
- Same stack, design system, plain-language UX rules and money rules (integer paise, Indian formatting) already in the app.
- When a step needs me (clicking in a website), stop, give me short numbered steps in plain words, and wait for "done".
- Never print secrets in the chat or commit them.
- Finish and check each phase before the next, with a 3-5 line summary.

---

## 1. How it works

1. When a quotation is marked **Accepted**, the app opens **one ticket per service** on that quotation. A quotation with SLA printing and UTM testing becomes 2 tickets.
2. Each ticket is a card on the board and moves through 4 columns:

| Column | What's on the card | Main button | Moves on when |
|---|---|---|---|
| 1. Waiting for PO | Ticket no., quotation no., company, service, amount | **Add PO** | A PO is saved |
| 2. Billing | + PO no. and date | **Export to Tally** (coming soon), **Upload tax invoice** | A tax invoice is saved |
| 3. Payment follow-up | + invoice no., amount due, due date, overdue status | **Send reminder**, **Add note**, **Record payment** | Fully paid |
| 4. Paid | + paid date | View | Closed |

3. Billing can happen before the work is done. There is no work-progress column.

---

## 2. Tickets

### 2.1 Opening tickets
- Changing a quotation's status to **Accepted** shows a confirmation: "This will open 3 tickets, one for each service. Continue?"
- On confirm, create one ticket per quotation line (custom items included) in a single transaction.
- Ticket number: `ACDRI/TK/2026-27/0001`, by financial year, generated inside the transaction like quotation numbers, never reused.
- Never create duplicate tickets. If the status changes back and forth, tickets for a line are created only once (unique on quotation line).
- **Ticket value:**
  - Each ticket stores a snapshot: service, department, quantity breakdown, list amount, member discount share, taxable value, GST (CGST + SGST or IGST) and total.
  - The ticket totals for a quotation must add up exactly to the quotation's grand total. Put any rounding difference on the last ticket.
- Existing quotations that are already Accepted: add a one-time, safe-to-rerun script `npm run tickets:backfill` that opens their tickets.

### 2.2 Locking the quotation
- Once a quotation has tickets, it can't be edited. Show a "Locked: tickets opened" note, plus a "Duplicate as revised quotation" button.
- Changing an accepted quotation's status away from Accepted:
  - If all its tickets are still in **Waiting for PO**: ask for confirmation, then cancel those tickets.
  - Otherwise: block it, with a plain message explaining why.

### 2.3 Cancelling a ticket
- "Cancel ticket" (in the card's menu) asks for a reason, e.g. "Customer dropped this service".
- Cancelled tickets leave the board and appear under a "Show cancelled" filter.

---

## 3. The board (`/orders`, nav item "Orders & Billing")

- **Column header:** name, a one-line help text, card count and total ₹ value.
  - "Waiting for PO: services accepted, PO not received yet"
  - "Billing: PO received, invoice not made yet"
  - "Payment follow-up: invoice sent, payment pending"
  - "Paid"
- **Card:**
  - Ticket no., company, service, department chip, amount
  - "4 days in this step"
  - Status chips, e.g. "Overdue by 12 days" in red, "Due today" in amber
  - One main button for its column
  - A "..." menu with View, Move back, Cancel
- **Moving cards:**
  - Drag and drop with `@dnd-kit`, plus the card buttons.
  - Dragging forward opens the form that step needs. Dragging into Billing opens "Add PO", and the card only moves once it's saved.
  - Cards can't skip a column.
  - Moving a card back asks for a reason and keeps the history. For example, "Wrong PO attached" clears the PO link but keeps the record.
  - Keyboard alternative: "Move to..." in the card menu.
- **Phone:** columns become tabs with counts (dragging is hard on phones). The card buttons do everything.
- **Filters:**
  - Search by ticket, quotation, company, PO no. or invoice no.
  - Department, customer
  - "Overdue only", "Follow-up due today", "Show cancelled"
- **Ticket detail** (side panel when a card is clicked):
  - All details and the linked quotation
  - Files: view PO, view invoice
  - A timeline of every event: ticket opened, PO added, billing details downloaded, invoice uploaded, each reminder, note and payment, each move

---

## 4. Step 2: Add PO

**Form fields:**

| Field | Rules |
|---|---|
| PO number | Required |
| PO date | Required, not in the future |
| PO amount (₹) | Required |
| PO copy | Upload PDF / JPG / PNG, up to 10 MB. Optional, but show "Recommended" |
| Notes | Optional |

**"This PO also covers"**
- A checklist of the same customer's other tickets in Waiting for PO, grouped by quotation.
- Tickets from the same quotation are ticked by default, because one PO usually covers the whole quotation.

**Amount check (never blocks saving)**
- Show: "PO amount ₹X. Selected services: ₹Y before GST, ₹Z with GST."
- If the PO amount matches neither, show an amber note: "PO amount doesn't match the quotation. Please check before billing."

**Duplicate PO number**
- If the same customer already has this PO number, warn and offer to link to the existing PO instead.

**On save:** every selected ticket moves to **Billing**.

---

## 5. Step 3: Billing

### 5.1 Export to Tally (placeholder for now)
- Show the button with a "Coming soon" badge.
- Clicking it opens a dialog:
  - Message: "Direct export to TallyPrime is coming soon. For now, download the billing details and create the invoice in TallyPrime."
  - Button: **"Download billing details (Excel)"**
- **The Excel file contains:**
  - Customer name, GSTIN, address, state, state code
  - PO no. and date, quotation no., ticket no(s).
  - For each service: description, quantity and unit, rate, discount, taxable value, CGST / SGST / IGST, total
- Customers' tickets in Billing can be ticked together ("Bill together"), so several services on one PO produce one file.
- Log each download as a billing export (method `EXCEL_MANUAL`) in a `billing_exports` table.
- **Keep it ready for later:**
  - Put the export behind an interface in `lib/tally/` (an `exportBilling(tickets)` contract) with a manual-Excel version now.
  - A TallyPrime version will be added later when we have Tally access.
  - Add a "Tally connection: not connected (coming soon)" section in Settings. Don't build any Tally connection now.

### 5.2 Upload tax invoice
**Form fields:**

| Field | Rules |
|---|---|
| Invoice number | Required, unique |
| Invoice date | Required |
| Invoice amount incl. GST (₹) | Required. Warn (do not block) if it differs from the selected tickets' total |
| Tax invoice file | Required, PDF / JPG / PNG, up to 10 MB |
| Credit period (days) | Pre-filled from the customer (default 30) |
| Due date | Auto = invoice date + credit period, editable |

**"This invoice also covers"**
- Other tickets of the same customer in Billing.
- Tickets with the same PO are ticked by default.

**On save:** every selected ticket moves to **Payment follow-up**.

---

## 6. Step 4: Payment follow-up (keep it simple for now)

Reminders, notes and payments belong to the **invoice**. Every ticket on that invoice shows them, with a chip like "Invoice INV-123, 3 services", and moves together.

### 6.1 Due status chip
- "Due in 5 days" (grey)
- "Due today" (amber)
- "Overdue by 12 days" (red)
- "Part paid: ₹4,000 left" (blue) when partly paid

### 6.2 Send reminder (no paid services, staff send it themselves)
- **WhatsApp:** opens `https://wa.me/91XXXXXXXXXX?text=...` to the contact person's mobile, with a ready-written message.
- **Email:** opens a `mailto:` link to the contact person, with a ready-written subject and message.
- Each click adds an entry to the timeline: "WhatsApp reminder opened by Demo User".
- The message templates live in Settings and can be edited. Placeholders: `{company}`, `{contact_name}`, `{invoice_no}`, `{invoice_date}`, `{amount_due}`, `{due_date}`, `{days_overdue}`.

Default WhatsApp message:
> Dear {contact_name}, this is a gentle reminder from ACDRI AutoCluster, Pune. Invoice {invoice_no} dated {invoice_date} for ₹{amount_due} is due on {due_date}. Kindly arrange the payment. Thank you.

### 6.3 Add follow-up note
| Field | Rules |
|---|---|
| How | Call / WhatsApp / Email / Visit / Other |
| Note | Required, e.g. "Spoke to accounts, payment next week" |
| Customer promised payment by | Optional date |
| Next follow-up date | Optional date |

### 6.4 Record payment
| Field | Rules |
|---|---|
| Amount received (₹) | Required |
| TDS deducted (₹) | Optional (customers often deduct TDS) |
| Payment date | Required |
| Mode | Bank transfer (NEFT / RTGS / IMPS), UPI, Cheque, Cash |
| Reference no. | Optional (UTR or cheque no.) |

- Amount left = invoice amount minus payments minus TDS.
- Part payments are allowed.
- When the amount left reaches ₹0, every ticket on the invoice moves to **Paid**.
- A payment can't be more than the amount left.

### 6.5 Follow-up due today
- The filter shows invoices where either:
  - the next follow-up date is today or earlier, or
  - the invoice is overdue with no note or reminder in the last 7 days.

---

## 7. Changes to existing screens

- **Customer form:** add "Credit period (days)", default 30, in Step 1 under Company. Customer detail gets an "Orders" tab listing their tickets and stages.
- **Quotation detail:** add a "Tickets" section showing each ticket's stage and a link to it on the board.
- **Home page:** add 4 stat cards, each opening the board with the matching filter:
  - Waiting for PO (count)
  - Ready to bill (count)
  - Outstanding (₹)
  - Overdue (₹)
- **Settings:**
  - Ticket number prefix (default `ACDRI/TK`)
  - Default credit period (30)
  - WhatsApp and email reminder templates
  - Tally connection placeholder

---

## 8. File uploads

- Store PO copies and tax invoices in **Vercel Blob**.
- Use Blob client uploads, so files up to 10 MB work on Vercel (server functions only accept about 4.5 MB).
- Only signed-in users can see files:
  - Never show the raw storage link.
  - Serve files through an app route, e.g. `/api/files/[id]`, that checks the sign-in first.
  - The upload token route checks the sign-in too.
- Accept only PDF, JPG and PNG. Show the file name and size, plus a "View" link after upload.
- `db:reset` also deletes uploaded demo files.

When you reach this phase, stop and give me plain steps to create the Blob store:
1. In Vercel, open the project, then **Storage**.
2. Create a Blob store and connect it to this project.
3. Get `BLOB_READ_WRITE_TOKEN` into my `.env.local`, using `npx vercel env pull` or by copying it.

---

## 9. Database (additive changes only; live Neon data must not be lost)

- `customers`: add `credit_days` (default 30)
- `tickets`:
  - id, ticket_no (unique), fy, seq
  - quotation_id, quotation_item_id (unique), customer_id
  - snapshot (jsonb)
  - list_amount, discount_amount, taxable_value, cgst, sgst, igst, total_amount
  - stage [WAITING_PO | BILLING | PAYMENT | PAID | CANCELLED], stage_changed_at
  - po_id, invoice_id
  - cancel_reason, created_at, updated_at
- `purchase_orders`: id, customer_id, po_number, po_date, po_amount, file_id, notes, created_at (unique on customer + PO number)
- `invoices`: id, customer_id, invoice_number (unique), invoice_date, amount, credit_days, due_date, file_id, created_at
- `payments`: id, invoice_id, amount, tds_amount, paid_on, mode, reference, notes, created_at
- `follow_ups`: id, invoice_id, method, note, promised_date, next_follow_up_date, created_at
- `files`: id, kind [PO | INVOICE], blob_path, file_name, size, mime, uploaded_at
- `ticket_events`: id, ticket_id, type, message, data (jsonb), created_by, created_at
- `billing_exports`: id, ticket_ids, method [EXCEL_MANUAL | TALLY], status, created_at
- `settings`: add ticket_prefix, default_credit_days, whatsapp_template, email_subject_template, email_body_template

---

## 10. Demo data

Update `db:seed` / `db:reset` so the board shows every situation:

- 2 tickets in **Waiting for PO**: one quotation with 2 services, no PO yet
- 2 tickets in **Billing**: one shared PO, with a sample PO PDF
- 3 tickets in **Payment follow-up**:
  - one due in 5 days
  - one due today
  - one overdue by 12 days, with one follow-up note and a part payment that includes TDS
- 1 ticket in **Paid**
- 1 cancelled ticket

Generate small sample PDFs clearly marked **"SAMPLE PO"** and **"SAMPLE TAX INVOICE"** (e.g. with `pdf-lib`) and upload them to Blob during seeding. All amounts must follow the real pricing rules.

---

## 11. Build phases

1. **Database:**
   - Add the new tables and columns.
   - Test locally first, then run `db:push` against Neon.
   - If `drizzle-kit` warns about losing data, stop and tell me.
2. **Tickets:** auto-opening on Accepted, numbering, value split, quotation lock, backfill script, cancel.
3. **Board:** columns, cards, drag and drop with step rules, phone tabs, filters, ticket detail with timeline.
4. **Blob setup + Add PO** (pause for my Blob steps).
5. **Billing:** Tally placeholder, Excel download, bill together, upload tax invoice.
6. **Payment follow-up:** due chips, reminders, notes, payments with TDS, auto-move to Paid.
7. **Home cards, Settings, customer and quotation links, demo data, tests.**
8. **Go live:**
   - Push to `main` so Vercel updates.
   - Add `BLOB_READ_WRITE_TOKEN` in Vercel if it isn't there.
   - Run `db:reset` on Neon.
   - Check the live site as in section 12.

---

## 12. Done checklist (must all pass, locally and on the live site)

Tests (Vitest):
- [ ] Accepting a quotation with 3 services opens exactly 3 tickets. Accepting again opens none.
- [ ] Ticket totals add up exactly to the quotation grand total, including the member discount and round off.
- [ ] 10 quotations accepted at the same moment get unique ticket numbers.
- [ ] A card can't skip a column. Moving back keeps the history.
- [ ] One PO saved on 3 tickets moves all 3 to Billing.
- [ ] One invoice on 2 tickets moves both to Payment follow-up, and its due date = invoice date + credit days.
- [ ] Amount left = invoice amount - payments - TDS. Overpaying is blocked. Reaching ₹0 moves every ticket on the invoice to Paid.
- [ ] The due chip shows "Due in X days", "Due today" and "Overdue by X days" correctly (India time, Asia/Kolkata).

Browser checks:
- [ ] Mark the MSME member SLA quotation as Accepted. A ticket appears in Waiting for PO for ₹8,496.
- [ ] Drag it to Billing. The Add PO form opens, and the card moves only after saving.
- [ ] Download billing details opens a correct Excel file.
- [ ] Upload a tax invoice. The card moves to Payment follow-up with the right due date.
- [ ] The WhatsApp button opens WhatsApp with the filled-in message, and the timeline logs it.
- [ ] A part payment with TDS shows the correct amount left. A full payment moves the card to Paid.
- [ ] Uploaded files open only when signed in. A signed-out visitor goes to the sign-in page.
- [ ] On a phone-width screen, columns show as tabs and nothing scrolls sideways.
- [ ] No technical words anywhere in the UI.

---

## 13. Final summary for me

In plain words, tell me:
1. What's new and where to find it.
2. Anything that didn't pass or that you had to work around.
3. Any assumptions I should confirm.
