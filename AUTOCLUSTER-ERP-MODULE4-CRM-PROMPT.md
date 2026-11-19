# Build Prompt: AutoCluster ERP Module 4 (CRM: Enquiries Pipeline)

The AutoCluster ERP has Customers, Quotations and Orders & Billing working, live on Vercel with Neon. Now add the step that comes before all of them: a **basic CRM**, where every enquiry is tracked on a Kanban board from first contact until it is won or lost.

Model it on the standard lead and opportunity pipelines in **Odoo CRM** and **Zoho CRM**, simplified for non-technical staff.

Same rules as before:
- Windows, PowerShell syntax for every command.
- Same stack, design system, plain-language UX rules and money rules (integer paise, Indian formatting).
- Reuse the existing Kanban components from Orders & Billing (`@dnd-kit`, column header, card, phone tabs, side panel).
- When a step needs me, stop, give me short numbered steps in plain words, and wait for "done".
- Never print secrets in the chat or commit them.
- Work on a new `module4-crm` branch, and commit and push after every phase.
- Test locally and on the Preview copy first. Live changes only in the last phase.

---

## 1. Where it goes

- New sidebar item **"CRM"** between Home and Customers. Use the lucide `Handshake` icon, in the same style as the existing items.
- New order: Home, **CRM**, Customers, Quotations, Orders & Billing, Rate Card, Settings.
- On phones, add CRM to the bottom bar or menu in the same position.
- Page title: "Enquiries". Pages:
  - `/crm` (board)
  - `/crm/list` (list view)
  - `/crm/enquiries/[id]` (full page for one enquiry)

---

## 2. How it works

1. Staff add each enquiry (phone call, walk-in, website, event, referral) as a card.
2. The card moves through stages. The default stages are:

| Stage | Type | Probability | Colour |
|---|---|---|---|
| New | Open | 10% | Grey |
| Contacted | Open | 30% | Blue |
| Negotiation | Open | 60% | Amber |
| Won | Won | 100% | Green |
| Lost | Lost | 0% | Red |

3. **Stages can be changed by an admin** (section 6).
4. **Won enquiries become customers and quotations** using the existing modules (section 8).

---

## 3. The board (`/crm`)

- **Top bar:**
  - "+ New enquiry" (main navy button)
  - Search: enquiry title, company, contact, mobile, email, enquiry no.
  - Filters: Assigned to, Source, Department, Priority, Tags, Activity (Overdue / Today / Upcoming / None), Expected close date
  - "Sort by": Priority, Next activity, Expected value, Newest
  - Board / List view switch
  - "Edit stages" (gear icon)
- **Column header:**
  - Stage name with its colour bar
  - Count of enquiries
  - Total expected value (₹)
  - A "..." menu: Rename, Change colour, Fold column, Move left / right, Delete
  - A "+" for quick add
- **Quick add** (Odoo style): a small card form at the top of the column with Enquiry title, Company, Contact name, Mobile, Expected value. Buttons: "Add" and "Edit full details".
- **Card:**
  - Enquiry title (bold) and company name
  - Expected value
  - Priority stars (0-3, clickable)
  - Source tag and department chips
  - Assigned person's initials in a circle
  - **Next activity icon:** green clock (planned), amber (today), red (overdue), grey "+" (no activity planned; click to plan one)
  - "6 days in this stage"
- **Moving cards:**
  - Drag freely between open stages, in either direction.
  - Dragging to **Lost** opens the Lost form (section 5.4). The card only moves once a reason is saved.
  - Dragging to **Won** moves it, then asks: "Make [Company] a customer now?" with "Yes, convert" and "Later".
  - Dragging a Won or Lost card back to an open stage reopens it. Log this in the history.
  - Keyboard alternative: "Move to..." in the card menu.
- **Folded columns:** a thin vertical strip showing the name and count. Click it to unfold.
- **Phone:** stages become tabs with counts, the same as the Orders board.
- **List view (`/crm/list`):**
  - Sortable table with the same filters: Enquiry no., Title, Company, Contact, Stage, Expected value, Expected close, Next activity, Assigned to, Source, Created
  - Tick boxes for bulk actions: change stage, assign to, add tag, delete
  - "Download as Excel"

---

## 4. Enquiry form ("+ New enquiry" and Edit)

Opens as a side panel, with "Open full page" for more room. Three cards on one screen:

**Card 1: Enquiry**

| Field | Rules |
|---|---|
| Enquiry title | Required, e.g. "3D printing of 20 prototype parts" |
| Source | Required. Dropdown from Settings: Website, Phone call, Walk-in, Email, WhatsApp, Referral, Exhibition / Event, MCCIA, Other |
| Department(s) interested | Optional. Chips: RPT / PPF / ENV / RPL |
| Services interested | Optional. Checklist from the rate card, filtered by the chosen departments |
| Expected value (₹) | Optional |
| Expected close date | Optional |
| Priority | 0-3 stars |
| Assigned to | Dropdown of team members from Settings |
| Tags | Optional. Pick or type a new tag |
| Stage | Defaults to the first open stage |

**Card 2: Company and contact**

| Field | Rules |
|---|---|
| Existing customer? | Toggle. When on, a searchable customer picker fills in every field below |
| Company name | Required |
| Contact person | Required |
| Designation | Optional |
| Mobile | 10-digit Indian mobile, +91 shown |
| Email | Valid email |
| City | Optional |
| Company category | Optional: OEM / Tier 1 / Tier 2 / MSME (used later when converting) |
| MCCIA member? | Optional Yes / No. Membership ID appears on Yes |

At least one of Mobile or Email is required.

**Card 3: Notes**: a free text box for the details of the enquiry.

**Duplicate check (never blocks saving):**
- When the mobile, email or company name matches an existing enquiry or customer, show an amber note: "A customer with this mobile already exists: Sahyadri Auto Components. Link to it?"
- Linking to a customer turns the toggle on and fills in the fields.

**Enquiry number:** `ACDRI/EN/2026-27/0001`, by financial year, generated inside a transaction like quotation numbers. The prefix can be changed in Settings.

---

## 5. Enquiry detail (side panel and `/crm/enquiries/[id]`)

### 5.1 Header
- Title, company, stage pill, expected value, priority, assigned to.
- **Stage bar** across the top (Odoo style): click a stage to move the enquiry there. The same Won and Lost rules apply.
- Buttons:
  - **"Plan activity"**
  - **"Create quotation"**
  - **"Mark as won"**, **"Mark as lost"**
  - "..." menu: Edit, Convert to customer, Delete (confirm + Undo)

### 5.2 Quick contact
- **Call:** `tel:` link
- **WhatsApp:** `wa.me` with a template message from Settings
- **Email:** `mailto:` with a template subject and message from Settings

Each click is logged in the history ("WhatsApp opened by Demo User").

Default WhatsApp message:
> Dear {contact_name}, thank you for your enquiry with ACDRI AutoCluster, Pune about {enquiry_title}. We will be happy to help. Please let us know a convenient time to discuss.

### 5.3 Activities (Odoo-style scheduled activities)
- **"Plan activity" form:**
  - Type: Call, Meeting, Email, WhatsApp, Site visit, Follow-up
  - Due date (required), time (optional)
  - Note
  - Assigned to (defaults to the enquiry's owner)
- The list shows planned activities first: overdue in red, today in amber, upcoming in green.
- **"Mark done"** asks for an outcome note, with two buttons: "Done" and "Done, plan next" (the second opens a new Plan activity form).
- Done activities move into the history.

### 5.4 Lost
- **Form:** Lost reason (required, from Settings: Price too high, Chose another provider, No budget, Not interested now, No response, Service not available, Other) and a note (optional).
- **Lost card:** red "Lost" label and the reason on the card.

### 5.5 History (timeline, newest first)
Every event, with date, time and person:
- Created
- Field changes (stage, value, assignee)
- Notes
- Activities planned and done
- Contact clicks
- Quotations created and accepted
- Conversion to customer
- Won and lost, with the reason

Add a **"Log a note"** box at the top for free notes.

### 5.6 Linked records
A section showing:
- The linked customer (with link)
- All quotations created from this enquiry, with status and amount
- Their tickets' stages (from Orders & Billing)

---

## 6. Editing stages (admin)

The demo has a single shared sign-in, so every signed-in user can edit stages for now.
- Put every stage-editing action behind one `canManagePipeline()` check that returns true today.
- Real admin roles can be added later without changing the screens.

**"Edit stages" panel** (gear icon on the board):
- List of stages with drag handles to reorder.
- For each stage: name (inline edit), colour (8 preset swatches), probability %, "Folded on the board" switch.
- "+ Add stage" (new open stage, placed before Won).
- Delete:
  - If the stage has enquiries, ask "Move its 4 enquiries to:" with a stage dropdown, then delete.
  - A stage with no enquiries just asks for confirmation.

**Rules (explain them in a small help line in the panel):**
- There must always be exactly **one Won** stage and **one Lost** stage. They can be renamed, recoloured and reordered, but not deleted or changed to another type.
- There must always be at least one open stage.
- Won and Lost stages always stay to the right of open stages.
- Changes apply for everyone immediately, and the board updates without reloading the page.
- Log stage changes (who, what, when) in a simple `crm_stage_changes` table.

The column header "..." menu offers Rename, Change colour, Fold, Move left / right and Delete. These use the same rules.

---

## 7. CRM settings (new "CRM" section in Settings)

Each list can be edited: add, rename, reorder, and hide instead of delete when the item is in use.
- Enquiry sources
- Lost reasons
- Tags
- **Team members:**
  - Name, mobile (optional), email (optional), active switch.
  - Used for "Assigned to". These are names only, not sign-in accounts.
- Enquiry number prefix (default `ACDRI/EN`)
- WhatsApp and email templates for enquiries. Placeholders: `{contact_name}`, `{company}`, `{enquiry_title}`.
- **Automatic moves:**
  - "When a quotation is created from an enquiry, move it to:" [stage dropdown, default Negotiation, or "Don't move"]
  - "When that quotation is Accepted, mark the enquiry as Won": always on, shown as information.

---

## 8. Links to the other modules

1. **Convert to customer:**
   - Opens the existing 3-step customer form with everything the enquiry has filled in: company, contact, designation, mobile, email, city, category, MCCIA membership, departments and services.
   - Staff complete the rest (address, GST, PAN and so on) and save.
   - The enquiry is then linked to the new customer.
   - If the enquiry is already linked to an existing customer, skip this step.
2. **Create quotation (from the enquiry):**
   - If the enquiry has no customer yet, convert first (step 1). Show a plain message explaining why: "A quotation needs the customer's GST and address. Let's add them first."
   - Then open the quotation builder with the customer selected. The enquiry's services appear in the existing "Services this customer uses" quick-add chips.
   - Save `lead_id` on the quotation.
   - Apply the automatic move rule from Settings.
3. **Quotation Accepted:**
   - If the quotation came from an enquiry, the enquiry moves to Won automatically (unless it's already Won), with a history entry.
   - Tickets open as they do today.
4. **Quotation Rejected:** show a suggestion on the enquiry: "Its quotation was rejected. Mark the enquiry as lost?" with a button. Don't move it automatically.
5. **Customer detail:** a new "Enquiries" tab listing that customer's enquiries.
6. **Quotation detail:** "From enquiry ACDRI/EN/2026-27/0004" with a link.
7. **Home page:**
   - Add 4 cards before the existing ones. Each opens the CRM with the matching filter.
     - New enquiries this month
     - Open enquiries value (₹)
     - Activities due today (with overdue count)
     - Won this month (₹)
   - Add a "Today's activities" list with "Mark done" buttons.

---

## 9. Import and export (standard in Odoo and Zoho, keep it simple)

- **"Import enquiries"** (in the board's "..." menu):
  1. Download an Excel template with the right columns and an example row.
  2. Upload the filled file.
  3. Preview the rows. Any row with a problem shows it in plain words, e.g. "Row 4: mobile number should have 10 digits".
  4. Import the good rows. Bad rows can be downloaded with their problems listed.
- The source and stage columns must match existing names. Unknown values show as problems; they are not created automatically.
- **Export:** "Download as Excel" in the list view, respecting the current filters.

---

## 10. Database (additive only; live data must not be lost)

- `crm_stages`: id, name, color, sort_order, type [OPEN | WON | LOST], probability, is_folded, created_at, updated_at
- `crm_stage_changes`: id, action, details (jsonb), created_by, created_at
- `leads`:
  - id, lead_no (unique), fy, seq, title
  - customer_id (nullable)
  - company_name, contact_name, designation, phone, email, city, category (nullable), is_mccia_member (nullable), mccia_membership_id
  - source_id, stage_id, priority (0-3), expected_value (paise), expected_close_date
  - assigned_to (team_member_id), notes
  - lost_reason_id, lost_note, won_at, lost_at, stage_changed_at
  - deleted_at, created_at, updated_at
- `lead_departments` (lead_id, dept_code)
- `lead_services` (lead_id, service_id)
- `crm_tags`, `lead_tags` (lead_id, tag_id)
- `crm_sources`: id, name, sort_order, is_active
- `crm_lost_reasons`: id, name, sort_order, is_active
- `team_members`: id, name, phone, email, is_active
- `crm_activities`: id, lead_id, type, due_date, due_time, note, assigned_to, done_at, outcome, created_at
- `lead_events`: id, lead_id, type, message, data (jsonb), created_by, created_at
- `quotations`: add `lead_id` (nullable)
- `settings`: add lead_prefix, lead_whatsapp_template, lead_email_subject_template, lead_email_body_template, quote_created_move_to_stage_id

---

## 11. Demo data

Add to `db:seed` / `db:reset`:
- **Default stages:** the 5 from section 2.
- **3 fictional team members:** Priya Shah, Rohan Kulkarni, Amit Patil.
- **Default sources, lost reasons, and tags:** Urgent, Repeat customer, Government, Startup.
- **12 enquiries:**
  - Spread across every stage, with all sources and priorities represented.
  - Mix of new companies and existing customers.
  - Activities: 2 overdue, 2 due today, 3 upcoming, and 2 enquiries with no activity planned.
- **2 Won enquiries:** one already linked to Sahyadri and its quotation, one converted to a new customer.
- **2 Lost enquiries:** "Price too high" and "No response".
- **One enquiry in Negotiation** with a quotation in Sent status, so the demo can show "Accept quotation → enquiry moves to Won".

Also add `npm run crm:seed`:
- It adds only the CRM demo data, and only if there are no enquiries yet.
- It never touches customers, quotations or orders.

---

## 12. Build phases (commit and push to `module4-crm` after each)

1. **Database, settings lists and default stages.**
2. **Board:** columns from the database, cards, drag and drop, Won and Lost rules, quick add, folded columns, phone tabs, filters, sort, list view with bulk actions.
3. **Enquiry form, detail panel and full page:** duplicate check, quick contact buttons, history, log a note.
4. **Activities:** plan, mark done, "Done, plan next", colour icons.
5. **Edit stages:** panel and column menu with all the rules.
6. **Links:** convert to customer, create quotation, automatic moves, customer and quotation links, home cards, Today's activities.
7. **Import and export.**
8. **Demo data, tests and go live:**
   - Test on the Preview copy.
   - Back up the live database.
   - Add the new tables to live.
   - **Ask me** whether to run `db:reset` on live (full demo) or only `npm run crm:seed` (keeps current live data).
   - Then merge to `main`, check the live site, and report.

---

## 13. Done checklist

Tests (Vitest):
- [ ] Enquiry numbers are unique when 10 are created at the same moment.
- [ ] Moving to Lost without a reason is refused.
- [ ] Exactly one Won and one Lost stage always exist. Deleting either, or changing its type, is refused.
- [ ] Deleting a stage with enquiries moves them to the chosen stage first, and nothing is lost.
- [ ] Reordering stages can't put an open stage after Won or Lost.
- [ ] Accepting a quotation linked to an enquiry moves the enquiry to Won exactly once.
- [ ] Creating a quotation from an enquiry follows the automatic move setting.
- [ ] Converting an enquiry pre-fills the customer form and links the new customer.
- [ ] The duplicate check finds matches by mobile, email and company name across enquiries and customers.
- [ ] Activity colours use India time (Asia/Kolkata): overdue, today, upcoming.
- [ ] Import accepts good rows, lists problem rows in plain words, and never creates unknown stages or sources.

Browser checks:
- [ ] CRM sits between Home and Customers in the sidebar and on phones.
- [ ] Add an enquiry by quick add and by the full form.
- [ ] Drag a card from New to Contacted to Negotiation. Dragging to Lost asks for a reason.
- [ ] Rename "Contacted" to "Follow-up", add a stage "Site visit", reorder it, then delete it, moving its enquiries. The board updates straight away.
- [ ] From the Negotiation enquiry, create a quotation, accept it, and see the enquiry move to Won and a ticket open in Orders & Billing.
- [ ] Plan an activity for today. It shows in the home page's "Today's activities", and "Mark done" works there.
- [ ] Import the template file with one bad row. The good rows import and the bad row is explained.
- [ ] On a phone-width screen, stages show as tabs and nothing scrolls sideways.
- [ ] No technical words anywhere in the UI.

---

## 14. Final summary for me

In plain words, tell me:
1. What's new and where to find it.
2. Anything that didn't pass or that you had to work around.
3. Any assumptions I should confirm.
