# Build Prompt: AutoCluster ERP Module 6 (Job Planning & Machine Booking)

The AutoCluster ERP has CRM, Customers, Quotations, Orders & Billing and Inventory working, live on Vercel with Neon. Now add **Planning**:
- every accepted service becomes a job
- jobs are booked on machines in a visual timeline
- operators start and finish work from their phone
- management sees how busy each machine is, how much work is waiting, and where actual hours differ from quoted hours

Model it on the job and work-order planning in **Odoo Manufacturing / Planning** and **Zoho**-style resource booking, simplified for lab and shop-floor staff.

Same rules as before:
- Windows, PowerShell syntax for every command.
- Same stack, design system, plain-language UX rules, money and quantity rules, file storage, auto-refresh rules and Excel import / export pattern.
- When a step needs me, stop, give me short numbered steps in plain words, and wait for "done".
- Never print secrets in the chat or commit them.
- Work on a new `module6-planning` branch. Add a test that every page data loader is safe, and run a local production build before every push. Commit and push after every phase.
- Test locally and on the Preview copy first. Live changes only in the last phase.
- All dates and times use India time (Asia/Kolkata).

---

## 1. Plain words (use these in the UI)

| Don't say | Say |
|---|---|
| Work order | Job |
| Gantt chart | Machine timeline |
| Resource / work centre | Machine |
| Capacity | Jobs at the same time |
| Utilisation | Machine use % |
| Backlog | Work waiting |
| Downtime | Machine not available |
| Lead time | Time needed |

---

## 2. Where it goes

- New sidebar item **"Planning"** between Orders & Billing and Inventory. Use the lucide `CalendarClock` icon.
- On phones, add Planning to the "More" sheet. The Home page on phones also shows a big **"Today's jobs"** shortcut card at the top.
- Pages, shown as tabs at the top of the Planning section:
  - `/planning` **Timeline**
  - `/planning/jobs` **Jobs**
  - `/planning/today` **Today**
  - `/planning/machines` **Machines**
  - `/planning/insights` **Insights**

---

## 3. Machines (`/planning/machines`)

### 3.1 Machine form

| Field | Rules |
|---|---|
| Machine name | Required, e.g. "SLA - 3D Systems 7000 HD" |
| Machine code | Auto `MC-01`, editable, unique |
| Department | Required, from the departments list (RPT / PPF / ENV / RPL / MET) |
| Make and model | Optional, e.g. "Tinius Olsen MP 600" |
| Key specs | Optional text, e.g. "Deep hole drilling to 650 mm depth at 20 mm diameter" |
| Test standards | Optional text, for lab machines, e.g. "ASTM D1238, ISO 1133" |
| NABL accredited | Switch |
| Services it can run | Optional. Checklist from the **whole** rate card, not only this machine's department (e.g. the Xenon chamber sits in ENV but runs the "Xenon test chamber" service priced under RPL). Several services can share one machine (SLA imported and SLA local resin both run on the 3D Systems 7000 HD), and one service can have several machines. A machine with no linked service shows a grey "Not on rate card" chip |
| Jobs at the same time | Number, default 1. Use more for chambers that hold several customers' samples at once |
| Runs day and night | Switch. On for chambers and ovens that run tests non-stop (they ignore working hours and holidays). Off for machines that need an operator (they follow working hours) |
| Where it is | Optional text |
| Status | Available / Under maintenance / Breakdown / Inactive |
| Notes | Optional |

**Machines not on the rate card.** Many machines (laser cutting, turn-mill, EDM, TGA, impact tester, CMM and others) have no rate-card price yet, so they are quoted as **custom items**. Custom items have no linked service, so a job from a custom item offers **every machine** in "Book time", filtered by department first.

### 3.2 Machines list
- Cards grouped by department. Each shows:
  - name, code, status chip
  - **"Now: Job ACDRI/TK/... for Western Drive"** or "Free"
  - next booking
  - **Machine use % this week**
- Buttons: "+ Add machine", "Block time".

### 3.3 Machine page
- A week calendar of its bookings and blocked time.
- Use % for this week and this month.
- Jobs history.
- Linked services.
- Buttons: Edit, Block time, Mark breakdown.

### 3.4 Block time (machine not available)
- Fields: machine, type, from, to, note.
  - Types: Maintenance, Calibration, Breakdown, Internal use / R&D, Other.
- Blocked time shows on the timeline as grey stripes, and nothing can be booked over it.
- **"Mark breakdown":**
  - Blocks the machine from now until a chosen time.
  - Then lists every booking that clashes, with "Move to next free slot" or "Pick another machine" for each.

---

## 4. Working hours (Settings > Planning)

- **Working days** (default Mon-Sat).
- **Shift:** 09:00 to 18:00, with an optional break of 13:00 to 13:30.
- **Holidays list:** date and name. Editable, plus "Import from Excel".
- Machines with "Runs day and night" ignore working hours and holidays.
- **Other machines:** a booking's end time is worked out over working hours only. A 6-hour job starting Friday 15:00 ends Saturday 12:00 (see the tests in section 13).
- Settings also holds:
  - default hold days for tentative bookings (7)
  - overrun warning % (50)
  - actual-vs-quoted alert % (10)

---

## 5. Jobs

### 5.1 Where jobs come from
- When a quotation is Accepted and its tickets open, the app **creates one job per ticket** with status **"To plan"**.
- The job uses the **ticket number** as its number, so staff deal with one number, not two.
- Add a safe-to-rerun `npm run jobs:backfill` that creates jobs for existing open tickets.
- **Cancelling a ticket** cancels its job and frees its bookings.

### 5.2 Job details

| Field | Rules |
|---|---|
| Time needed (hours) | Suggested, editable. Per-hour services: the ticket's billable hours. Other services: from the service's time settings (section 5.4). Staff can always change it, e.g. use the print time from the slicer |
| Promised date | Optional. The date promised to the customer |
| Priority | Normal / Urgent |
| Default operator | From team members |
| Instructions | Free text, e.g. test standard, conditions, drawing revision |
| Attachments | Optional (drawings, test plan), in Vercel Blob |

### 5.3 Job status flow

| Status | Meaning |
|---|---|
| **To plan** | Not booked yet |
| **Planned** | Has booking(s) covering the time needed |
| **Running** | An operator pressed Start |
| **On hold** | Paused with a reason: Waiting for customer, Waiting for material, Machine problem, Other |
| **Done** | Work finished |
| **Handed over** | Parts or samples given back to the customer (date, received by) |
| **Cancelled** | Ticket cancelled |

Every change is logged in the job's history.

### 5.4 Time settings per service (Rate Card page)
- Each service gets **"Time needed"** settings:
  - setup time (minutes)
  - time per unit (e.g. 15 min per sample for FTIR)
- They're used only to suggest the job's time needed.
- Show an amber "No time set" chip, with a filter, like "No materials set".

### 5.5 Job panel (side panel, opened from anywhere)
- Header: ticket no., customer, service, status, promised date, priority.
- **Plan** section:
  - its bookings (machine, start to end, operator, tentative or firm)
  - "Planned 6 of 8 hours"
  - a **"+ Book time"** button
- **Work** section:
  - time log (start, pause, resume, done, with who)
  - actual hours
  - **"Actual vs quoted"** for per-hour services (e.g. "Quoted 6 h, took 7 h (+17%)")
- Materials used (from Inventory), with the "Record materials" button.
- Links to the ticket, quotation and customer.
- History.

---

## 6. Booking machine time

### 6.1 "Book time" form

| Field | Rules |
|---|---|
| Machine | Machines linked to the job's service. "Show all machines" can widen the list. Jobs from custom items show all machines, grouped by department |
| Start date and time | Required, snaps to 30 minutes |
| Hours | Defaults to the hours still unplanned |
| Ends | Worked out live using working hours (or non-stop), e.g. "Ends Sat 28 Nov, 12:00" |
| Operator | Defaults to the job's operator |
| Note | Optional |

**"Find next free slot"** button:
- Finds the earliest slot on any suitable machine that fits the hours.
- It respects working hours, holidays, blocked time and jobs at the same time.
- Shows the top 3 options with machine and end time, e.g. "SLA - 3D Systems 7000 HD, Mon 30 Nov 09:00 to 13:00".
- One tap books it.

**Warnings (never silent):**
- If the job would finish after the promised date: amber note "Finishes 2 days after the promised date".
- Booking in the past asks for confirmation (for recording work already done).

### 6.2 Booking rules
1. A machine can never have more bookings at the same moment than its "Jobs at the same time".
2. Nothing can be booked over blocked time, or on a machine that is Inactive or in Breakdown.
3. A job can have several bookings (split work, or several machines).
4. Each save locks the machine inside a transaction (`SELECT ... FOR UPDATE`), so two people can never book the same slot at the same moment.
5. A booking that has started can't be moved. Only its end can be changed.
6. Clashes are refused with a plain message, e.g. "SLA - 3D Systems 7000 HD is already booked for ACDRI/TK/2026-27/0007 from 10:00 to 14:00."

### 6.3 Tentative bookings (before the PO arrives)
- Tickets still in "Waiting for PO" can be booked, but only as **tentative**, with a "Hold until" date (default today + 7 days, from Settings).
- They show as amber stripes labelled "Tentative: waiting for PO".
- When the PO is saved in Orders & Billing, its tentative bookings **become firm automatically**, with a history line.
- An expired hold turns red and is listed under "Needs attention". Staff can extend it or release it. It is never deleted automatically.

---

## 7. Timeline (`/planning`)

- **Rows:** machines grouped by department, with collapsible groups. **Columns:** time.
- **View switch:** Day (hours), Week (days split into shifts), 2 weeks.
- "Today" button, previous / next arrows, a date picker, and a red "now" line.
- Shaded non-working hours for machines that need an operator.
- **Bookings** are coloured bars. The label shows ticket no., customer and service. Colours:
  - blue = planned
  - green = running
  - amber stripes = tentative
  - red outline = late (past the promised date)
  - grey stripes = blocked time
- **Left side panel, "To plan":**
  - Jobs waiting, grouped by department, with hours, promised date and priority.
  - Drag a job onto a machine row to open "Book time" with the machine and start filled in.
- **Drag a booking** to move it. **Drag its right edge** to change its hours.
  - It snaps to 30 minutes and uses the same rules as the form.
  - An invalid drop springs back with the plain reason.
- Click a booking to open the job panel.
- **Filters:** department, machine, operator, customer, "Late only", "Tentative only".
- **Phone:** the timeline is replaced by a **day list per machine** (agenda). Booking is done through the "Book time" form.
- **Build:**
  - Build it with CSS grid + the existing `@dnd-kit`, or with an MIT / Apache-licensed timeline library.
  - **Do not use any paid or non-commercial-licence library** (e.g. FullCalendar's premium resource timeline).
  - It must stay smooth with about 20 machines and 2 weeks of bookings.

---

## 8. Today (`/planning/today`), made for operators on phones

- "Who's working?" picks a team member, remembered on that device. Show their jobs for today (and running ones), in time order.
- **Each job card:**
  - Machine, customer, service, booked time, instructions.
  - Big buttons: **Start**, **Pause** (asks the reason), **Resume** and **Done**.
- **Start:**
  - Sets the job to Running and the machine to "Now: ...".
  - Only one running job per operator at a time; warn and offer to pause the other.
- **Done:**
  - Asks: completion note (required), actual quantity done (optional, e.g. "18 of 20 parts"), and any problems.
  - If the service has a materials list and nothing is recorded yet, it then asks **"Record materials now?"** (opens the existing form).
  - Then offers **"Tell the customer it's ready"**: a `wa.me` message from a Settings template, logged in history.
- **Handed over:** a button on Done jobs asks for date and received by.
- **Overrun warning:**
  - A running job past its booked end by more than 50% (Settings) shows "Still running? Started 14 h ago" on the card, timeline and Overview, with "Pause" or "Done".
  - Nothing stops by itself.
- Actual hours = the total of running periods, with pauses excluded.

---

## 9. Jobs list (`/planning/jobs`)

- Table with search (ticket no., customer, service).
- Filters:
  - status, department, machine, operator
  - promised date
  - "Late", "Not planned", "Actual over quoted"
- Columns:
  - ticket no., customer, service, status, machine(s)
  - planned start to end
  - promised date
  - time needed, planned, actual
  - operator
- Bulk: set operator, set priority.
- "Download as Excel".

---

## 10. Links to other modules

- **Orders & Billing:**
  - Each ticket card shows a small job chip: "To plan", "Planned 24 Nov, SLA 7000 HD", "Running", "Done" or "Handed over".
  - The ticket panel shows the job section, with a link to open it.
  - New board filter: "Work not done".
- **Quotation builder:** for each service, a small hint: "Earliest free slot: Thu 26 Nov (SLA 7000 HD)". This helps sales promise realistic dates. It never blocks anything.
- **Inventory:** the Done flow offers "Record materials" (section 8). Machine maintenance blocks can link to an internal-use stock record for spares, if one was made.
- **CRM:** none needed.
- **Home page** (cards open the matching filter):
  - Jobs to plan
  - Running now
  - Late jobs
  - Machines not available

  On phones, also the "Today's jobs" shortcut.
- **Needs attention** (top of the Timeline):
  - late jobs
  - expired tentative holds
  - overruns
  - jobs past their promised date that are still not planned
  - bookings that clash with a new breakdown

---

## 11. Insights (`/planning/insights`)

- Date range picker (default this month) and a department filter.
- Each section gets a one-line plain explanation and "Download as Excel".

| Section | Shows |
|---|---|
| Machine use % | For each machine: booked hours ÷ available hours, and actual running hours ÷ available hours. Available = working hours (or 24 h a day for day-and-night machines) minus blocked time. Busiest first. Plain line: "5-axis machining is 92% booked for the next 2 weeks. Consider an extra shift." |
| Work waiting | For each department: hours of jobs to plan + planned future hours, shown as "about X working days of work". |
| Quoted vs actual hours | Per-hour services only. Jobs where actual hours were more than 10% (Settings) above the quoted hours, with the ₹ value of the extra hours at the customer's rate. Plain line: "These jobs took 23 more hours than quoted, worth about ₹41,000 not billed." |
| On-time delivery | % of jobs done by their promised date, by department and month. The late jobs are listed. |
| Machine not available | Hours blocked by type (maintenance, calibration, breakdown) per machine, by month. |
| Earnings per machine hour | For each machine: ticket value before GST of jobs done ÷ actual running hours. |

Use the same chart approach as Inventory Insights (Recharts).

---

## 12. Database (additive only; live data must not be lost)

- `departments`: add **MET - Metrology & CMM** ("Large-bed measurement of dies, auto and mechanical parts"). Check that every screen listing departments (customer form, CRM, Inventory, filters, Insights) reads them from the table and handles 5, with nothing hard-coded to 4.
- `machines`:
  - id, code (unique), name, dept_code, location
  - make_model, key_specs, test_standards, nabl_accredited
  - status [AVAILABLE | MAINTENANCE | BREAKDOWN | INACTIVE]
  - parallel_jobs (default 1), runs_nonstop
  - notes, is_active, sort_order, created_at, updated_at
- `machine_services` (machine_id, service_id)
- `machine_blocks`:
  - id, machine_id
  - type [MAINTENANCE | CALIBRATION | BREAKDOWN | INTERNAL | OTHER]
  - start_at, end_at, note, inv_document_id (nullable)
  - created_by, created_at
- `holidays`: id, date (unique), name
- `jobs`:
  - id, ticket_id (unique)
  - status [TO_PLAN | PLANNED | RUNNING | ON_HOLD | DONE | HANDED_OVER | CANCELLED]
  - hours_needed, promised_date, priority, operator_id
  - instructions, hold_reason
  - done_at, done_note, qty_done
  - handed_over_at, handed_over_to
  - created_at, updated_at
- `job_files`: job_id, file_id
- `job_bookings`:
  - id, job_id, machine_id
  - start_at, end_at, hours, operator_id
  - is_tentative, hold_until, note
  - created_by, created_at, cancelled_at
- `job_time_logs`: id, job_id, booking_id, machine_id, operator_id, started_at, ended_at, pause_reason
- `job_events`: id, job_id, type, message, data (jsonb), created_by, created_at
- `services`: add setup_minutes, minutes_per_unit (nullable)
- `settings`:
  - working_days, shift_start, shift_end, break_start, break_end
  - tentative_hold_days, overrun_warning_pct, actual_vs_quoted_alert_pct
  - ready_whatsapp_template

Store times as `timestamptz`. Do all working-hours maths in `lib/planning/` with unit tests.

---

## 13. Demo data

Add to `db:seed` / `db:reset`, keeping all existing demo stories working:

- **ACDRI's real machines**, from the equipment catalogue at https://auto-cluster-kohl.vercel.app/equipment, plus 3 machines that are on the rate card but not in the catalogue (33 in total). Use these exact names, makes and specs:

  **PPF - Prototype Production Facility**
  | Machine | Make / model | Key specs | Runs on rate card service |
  |---|---|---|---|
  | 5-Axis VMC (Non-Continuous) | Rambaudi | Large-envelope 5-axis: 2D/3D profiles, boring, drilling, reaming, side-face work | 5-axis machining |
  | 3-Axis VMC | Hartford | 16-tool automatic tool changer: profiling, boring, drilling, reaming | (none) |
  | 5+1 Axis Laser (Rotary Attachment) | TRUMPF | 5-axis laser cutting with rotary attachment and welding head. Oxygen cutting up to 12 mm, nitrogen up to 8 mm | (none) |
  | 3+1 Axis VMC (Rotary Attachment) | TAI | Rotary attachment, 20-tool automatic tool changer | 3+1 axis machining |
  | Turn Mill Centre | ACE | Turning and milling in one setup, 12-station turret | (none) |
  | Deep Hole Drilling | Ixion | Single stroke to 650 mm depth at 20 mm diameter | (none) |
  | Die Sinking EDM | | Specs pending | (none) |
  | W-EDM | | Submerged-type CNC wire EDM, specs pending | (none) |

  **RPT - Rapid Prototyping**
  | Machine | Make / model | Key specs | Runs on rate card service |
  |---|---|---|---|
  | SLA - 3D Systems 7000 HD | 3D Systems ProX 7000 HD | High-detail parts and investment casting patterns | SLA imported resin, SLA local resin |
  | SLS - EOS P385 | EOS P385 | Polyamide functional parts, medical and architectural models | SLS |
  | FDM - Stratasys 450 MC | Stratasys Fortus 450mc | Production-grade ABS and ASA | (none) |
  | Vacuum Casting - KLM | KLM | Silicone-tool short runs, flexible and rigid parts | (none) |
  | Figure 4 Standalone Pro | (rate card only) | | Figure 4 Standalone Pro, black |
  | Origin 1 SLA | (rate card only) | | Origin 1 SLA |

  **ENV - Environmental Testing** (all NABL accredited, all run day and night)
  | Machine | Runs on rate card service |
  |---|---|
  | Xenon Test Chamber | Xenon test chamber (priced under RPL) |
  | Salt Spray Test Chamber (2 jobs at the same time) | Mini salt spray chamber |
  | Dust Spray Test Chamber | Dust spray chamber |
  | Water Spray Test Chamber | Water spray chamber |
  | Thermal Shock Test Chamber | Thermal shock chamber |
  | High-Low Temperature Chamber | High-low chamber |

  **RPL - Rubber & Polymer Lab** (all NABL accredited)
  | Machine | Make / model | Test standards | Runs on rate card service | Day and night |
  |---|---|---|---|---|
  | Universal Testing Machine (UTM) | Tinius Olsen | ASTM D638, ASTM D412, ISO 178 | UTM | No |
  | Thermogravimetric Analyser (TGA) | Shimadzu | | (none) | No |
  | Instron Actuator (fatigue) | Instron | | (none) | Yes |
  | Ozone Test Chamber | In 2000 - L2 (low concentration) | ASTM D1171, ASTM D1149 | Ozone chamber | Yes |
  | Impact Tester | CEAST S.p.A. Resil Impactor | ISO 180, ISO 179 | (none) | No |
  | Accelerated Weathering Tester (QUV/Spray) | Q-Lab | | QUV Weather-Ometer | Yes |
  | Melt Flow Indexer | Tinius Olsen MP 600 | ASTM D1238, ISO 1133 | Melt flow index | No |
  | Differential Scanning Calorimeter (DSC) | Shimadzu DSC 60 | ASTM E928, ASTM D1525, ASTM D648 | DSC | No |
  | HDT & VICAT Softening Temperature Tester (3 jobs at the same time, one per station) | CEAST S.p.A. HDT 3 | ASTM D648, ASTM D1525 | (none) | No |
  | Multi Head Micro Hardness Tester | Gibitre | ISO 48, ISO 868, BS 903 | (none) | No |
  | FTIR Spectrometer | Thermo Electron Nicolet 380 | ASTM E1252 | FTIR | No |
  | Hot Air Oven | (rate card only) | | Hot air oven | Yes |

  **MET - Metrology & CMM** (new department)
  | Machine | Make / model | Key specs | Runs on rate card service |
  |---|---|---|---|
  | Co-ordinate Measuring Machine (CMM) | Accurate Cordimesur | Large-bed measurement of dies, auto and mechanical parts, prototypes | (none) |

- **Organisation profile in Settings:** set the demo defaults to ACDRI's real contact details from the website, so quotations and PDFs show them:
  - Name: Auto Cluster Development and Research Institute (ACDRI)
  - Address: H-Block, Plot No. C-181, Chinchwad East, Mumbai Pune Road, Pune 411 019, Maharashtra
  - Phone: +91 20 6633 3700
  - Email: customersupport@autoclusterpune.org
  - GSTIN stays a placeholder.
- **Demo jobs** should include a few custom-item jobs on machines that aren't on the rate card (e.g. laser cutting, CMM inspection), so that path is shown.
- Time settings for most services.
- Holidays for the coming months.
- **Jobs and bookings for the past 8 weeks** (with time logs, to feed Insights) **and the next 2 weeks**, using the historic jobs from Module 5 where they fit. Include:
  - 5-Axis VMC heavily booked (90%+ for the next 2 weeks), Ozone Test Chamber rarely used
  - one machine under maintenance next week, and one breakdown last month
  - jobs to plan (one urgent, one past its promised date)
  - one job running now, one on hold "Waiting for customer drawings"
  - one late job
  - one tentative booking whose hold expires tomorrow, and one already expired
  - three past per-hour jobs that took more than 10% longer than quoted
- Use a fixed random seed.
- Report the demo story numbers in the final summary.

---

## 14. Build phases (commit and push to `module6-planning` after each)

1. **Database, working hours, holidays, machines** (list, form, page, linked services), time settings on the Rate Card.
2. **Jobs from tickets** (and backfill), job panel, jobs list, Book time form with Find next free slot, all booking rules, tentative bookings, blocked time and breakdown handling.
3. **Timeline:** rows, views, drag from To plan, move and resize, phone day list, Needs attention.
4. **Today for operators:** Start / Pause / Resume / Done, time logs, overrun warnings, Record materials prompt, Tell the customer, Handed over.
5. **Links:** Orders job chips and filter, quotation builder earliest-slot hint, home cards, phone shortcut.
6. **Insights.**
7. **Demo data, tests and go live:**
   - Test on the Preview copy.
   - Back up live.
   - Add the new tables to live.
   - Run `db:reset` on live (full demo); no need to ask.
   - Merge to `main` and check the full story on the live site.
   - Run `db:reset` on live again so the demo starts clean, and confirm `main` and the branch match.

---

## 15. Done checklist

Tests (Vitest), with shift 09:00-18:00, break 13:00-13:30, Mon-Sat, and a holiday on Fri 25 Dec 2026:
- [ ] **Shift machine, 6 h from Fri 27 Nov 15:00:** 3 h Friday + 3 h Saturday → ends **Sat 28 Nov 12:00**.
- [ ] **Shift machine, 6 h from Sat 28 Nov 16:00:** 2 h Saturday, Sunday skipped, 4 h Monday → ends **Mon 30 Nov 13:00**.
- [ ] **Shift machine, 4 h from Thu 24 Dec 16:00:** 2 h Thursday, holiday skipped → ends **Sat 26 Dec 11:00**.
- [ ] **Day-and-night chamber, 96 h from Mon 30 Nov 10:00:** ends **Fri 4 Dec 10:00**.
- [ ] **Jobs at the same time:**
  - With 1, an overlapping booking is refused.
  - With 2, a third overlapping booking is refused.
  - 10 bookings for the same slot saved at the same moment: only the allowed number succeed.
- [ ] Bookings over blocked time, or on a machine in Breakdown or Inactive, are refused.
- [ ] Accepting a quotation with 3 services creates 3 jobs in To plan. Cancelling a ticket cancels its job and frees its bookings.
- [ ] Tentative bookings become firm when the PO is saved. Expired holds are flagged, never deleted.
- [ ] Find next free slot returns the earliest valid slot, respecting hours, holidays, blocks and jobs at the same time.
- [ ] **Actual hours:** start 10:00, pause 12:00, resume 14:00, done 15:30 → **3.5 h**.
- [ ] **Actual vs quoted:** a per-hour job quoted 6 h that took 7 h shows +16.7% and is flagged.
- [ ] Machine use % is correct for shift machines (working hours minus blocks) and day-and-night machines (24 h minus blocks).

Browser checks:
- [ ] Accept the Sahyadri SLA quotation. A job appears in To plan. Drag it onto SLA - 3D Systems 7000 HD and the end time is worked out.
- [ ] A job from a custom quotation item (e.g. CMM inspection) can be booked on the CMM, which has no rate-card service.
- [ ] MET - Metrology & CMM appears everywhere departments are listed (customer form, CRM, Inventory, filters), and nothing breaks with 5 departments.
- [ ] Try to drag another job onto the same time. It springs back with the reason.
- [ ] Book a tentative slot for a Waiting-for-PO ticket, add the PO in Orders, and the booking turns firm.
- [ ] Mark a machine as breakdown. Its clashing bookings are listed and can be moved to the next free slot.
- [ ] On a phone-width screen, Today shows the operator's jobs. Start, Pause, Resume and Done work, Done offers Record materials, then the WhatsApp ready message opens.
- [ ] The quotation builder shows the earliest free slot for a service.
- [ ] Insights shows the 5-axis busy story and the quoted-vs-actual story.
- [ ] No page scrolls sideways at phone width, and there are no technical words in the UI.

---

## 16. Final summary for me

In plain words, tell me:
1. What's new and where to find it.
2. The demo story to show (with the new numbers).
3. Anything that didn't pass or that you had to work around.
4. Any assumptions I should confirm.
