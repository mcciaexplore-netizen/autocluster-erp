# AutoCluster ERP (demo)

Two modules for front office and department coordinators:

1. **Customers**: save a company once, with its departments and the services it uses.
2. **Quotations**: pick a customer, add services, and get a quotation PDF with the right price, member discount and GST worked out automatically.

When `DEMO_PASSWORD` is set, the site asks for a password first (cookie lasts 7 days; **Sign out** is in the top-right menu).

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui, React Hook Form + Zod, Drizzle ORM on Postgres (Neon), and @react-pdf/renderer.

---

## Setup on Windows (PowerShell, VS Code terminal)

You need **Node.js 22** (`node -v`). The project includes `.nvmrc` and `"engines": { "node": "22.x" }`.

```powershell
# 1. Install packages
npm install

# 2. Create your local settings file, then fill in the values (see the table below)
Copy-Item .env.example .env.local
code .env.local

# 3. Create the tables
npm run db:push

# 4. Load demo data (only works on an EMPTY database; it never deletes anything)
npm run db:seed

# 5. Start the app, then open http://localhost:3000
npm run dev
```

### Settings (`.env.local`)

| Name | What it is |
|---|---|
| `DATABASE_URL` | Database the app uses. On Neon: the **pooled** connection string. Locally: your local Postgres. |
| `DATABASE_URL_UNPOOLED` | Neon's **direct** string (pooling OFF). Used by `db:push`, `db:seed` and `db:reset`. If empty, they use `DATABASE_URL`. |
| `DEMO_PASSWORD` | Password for the sign-in screen. Leave it empty to turn the sign-in screen off (handy locally). |
| `AUTH_SECRET` | Long random text that signs the sign-in cookie. At least 32 characters. Make one with the command below. |

```powershell
# Make a new AUTH_SECRET (copy the output into .env.local)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`.env.local` is never committed to Git. Only `.env.example` (names, no values) is.

### Demo data

```powershell
npm run db:seed    # loads demo data into an EMPTY database; stops if customers already exist
npm run db:reset   # WIPES everything and reloads clean demo data; asks you to type RESET
```

Use `npm run db:reset` before a demo. It works on whichever database `.env.local` points to, and says which one before asking.

### Other commands

```powershell
npm test            # pricing, validation and sign-in tests (Vitest)
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm run build       # production build
npm run start       # run the production build locally
npm run db:studio   # browse the database in a web page
node scripts/embed-fonts.mjs   # only if you change the PDF fonts in assets/fonts
```

---

## Deployment (Vercel + Neon)

### 1. Neon database
1. Keep a copy of your local settings: `Copy-Item .env.local .env.local.localdb`
2. Sign in at https://console.neon.tech and click **New Project**. Name: `autocluster-erp`. Region: **AWS Asia Pacific (Mumbai)** if listed, otherwise **Singapore**.
3. Click **Connect**. With **Connection pooling ON**, copy the string into `.env.local` as `DATABASE_URL=`.
4. Turn **Connection pooling OFF**, copy the string into `.env.local` as `DATABASE_URL_UNPOOLED=`.
5. Add `DEMO_PASSWORD=` with a password of your choice. Make sure `AUTH_SECRET=` is filled in.
6. In `vercel.json`, set `"regions"` to `["bom1"]` for Mumbai or `["sin1"]` for Singapore.

```powershell
npm run db:push
npm run db:seed
npm run build
npm run start      # test at http://localhost:3000 against Neon
```

### 2. GitHub
Push the code to a **private** repository (for example `autocluster-erp-demo`). Check `git status` first: no `.env` file except `.env.example` may appear.

### 3. Vercel
1. At https://vercel.com click **Add New > Project** and import the repository. Leave the framework (Next.js) and build settings as they are.
2. Under **Environment Variables**, add `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEMO_PASSWORD` and `AUTH_SECRET`, copying the values from `.env.local`.
3. Click **Deploy**.
4. Check **Settings > General > Node.js Version** is **22.x**, and **Settings > Functions > Function Region** matches the Neon region.

Every push to the `main` branch updates the live site automatically. Changing an environment variable needs a **Redeploy** (Deployments > ... > Redeploy).

### Switching back to the local database
```powershell
Copy-Item .env.local .env.local.neon      # keep the Neon settings
Copy-Item .env.local.localdb .env.local   # use the local database again
```

### Notes
- The app uses the `pg` driver with a small pool kept on `globalThis`, reused across requests, so it works with Neon's pooled connection from Vercel functions and supports the transaction that creates quotation numbers. SSL is used for every non-local database.
- All database and PDF code runs on the Node.js runtime. The PDF fonts are bundled in `lib/pdf/fonts.generated.ts`, not read from disk.
- Neon's free plan pauses the database when idle, so the first page after a quiet spell can take a second or two longer.

---

## Where things are

| Path | What it does |
|---|---|
| `lib/pricing.ts` | **Single source of truth** for rates, member discount, quantities, GST, round off, amount in words and quotation numbers. Tested in `lib/pricing.test.ts`. |
| `lib/quote-calc.ts` | Turns the services added in the builder into priced lines and totals. Runs live in the browser and again on the server when saving. |
| `db/schema.ts` | Database tables (section 8 of the brief). |
| `db/quote-writer.ts` | Saves quotations: recalculates every amount, stores the customer and rate snapshot, takes the next number inside a transaction. |
| `scripts/demo-data.ts`, `scripts/seed.ts`, `scripts/reset.ts` | Demo data, safe seed, and reset. |
| `proxy.ts`, `lib/auth.ts`, `app/login` | Demo password sign-in. |
| `lib/actions/` | Server actions (each one checks sign-in). |
| `app/(app)/customers`, `components/customers` | Customers list, 3-step wizard, detail page. |
| `app/(app)/quotations`, `components/quotations` | Quotation builder, list, detail page, PDF (`app/(app)/quotations/[id]/pdf`). |
| `app/(app)/rate-card`, `app/(app)/settings` | Rate Card and Settings pages. |
| `assets/fonts`, `lib/pdf/` | PDF fonts (source files, bundled into `fonts.generated.ts`) and the PDF layout. |

### How money is handled
All money is calculated in whole **paise** (₹1 = 100 paise) with `decimal.js` for quantity x rate, so there is no floating-point rounding. The database stores money as `numeric(14,2)`.

### How quotation numbers work
Format `ACDRI/QT/2026-27/0001`. The financial year runs April to March. A counter row per financial year is incremented inside the same transaction that saves the quotation, so two people saving at once never get the same number, and numbers are never reused. (Tested with 10 saves at the same moment.)

---

## Assumptions (please confirm)

From the brief:

1. Department codes: RPT = Rapid Prototyping, PPF = Prototype Production Facility, ENV = Environmental Testing, RPL = Rubber & Polymer Lab.
2. "Company category" (OEM / Tier 1 / Tier 2 / MSME) is on the customer form because the rate depends on it.
3. The member discount also applies to non-MSME members (on the OEM rate). The published rate card only mentions MSME members, so this is a switch in Settings (on by default).
4. GST is 18% (not stated on the rate card). Editable in Settings.
5. Xenon and QUV: one run holds up to 3 samples, charged per hour per run (8 hours, 5 samples = 2 runs = 16 hours).
6. TAN is optional.

Decisions made while building:

7. **Quotation table layout**: each line shows the list rate and list amount; the member discount is taken off once in the totals block ("Less: MCCIA member discount"). This way the subtotal always equals the sum of the lines. The builder screen also shows each line's discounted rate, e.g. "₹40 → ₹36 per cc".
8. **Editing an old quotation keeps its saved rates.** Only lines you change by hand, or a change of customer, use today's rate card.
9. **Changing a rate** on the Rate Card sets its "Effective from" date to today. It affects new quotations only.
10. **Quotation number in the preview** is a preview only. The real number is given when the quotation is saved (if someone else saves first, you get the next one).
11. **Print** saves the quotation first, then opens the print view, so a printed quotation always has its real number.
12. **Customers not registered under GST** are taxed by the state chosen on their form (CGST + SGST if Maharashtra, otherwise IGST).
13. **Deleting a customer** hides them (soft delete) and keeps their quotations. Undo is available for 5 seconds.
14. **Duplicate** copies the customer, services and the original rates into a new draft with a new number and today's date.
15. **Logo upload** is a placeholder for the demo.
16. Organisation address, GSTIN, phone and email in the demo data are placeholders. Update them in Settings.

---

## Done checklist (section 11)

| Check | Result |
|---|---|
| MSME member, Maharashtra, SLA imported 50 cc x 4 | ₹8,496 (CGST ₹648 + SGST ₹648) ✅ |
| OEM non-member, Karnataka, 5-axis 6 hours | ₹14,160 (IGST ₹2,160) ✅ |
| Tier 1 member, Maharashtra, UTM 5 samples | ₹11,151 (CGST ₹850.50 + SGST ₹850.50) ✅ |
| MSME non-member, Maharashtra, Xenon 8 h, 5 samples | ₹1,510.40 → ₹1,510 ✅ |
| "Add new customer" opens the form immediately | ✅ |
| Membership ID appears only for "Yes" and is required then | ✅ |
| GST number fills State and PAN | ✅ |
| Friendly messages for wrong GST / PAN / TAN / phone / email | ✅ |
| Step 3 shows each service at that customer's price | ✅ |
| Choosing a customer in the builder fills their details | ✅ |
| Quantity inputs change with how the service is charged | ✅ |
| Totals update live; CGST + SGST in Maharashtra, IGST elsewhere | ✅ |
| Unique numbers in the `ACDRI/QT/2026-27/0001` format | ✅ |
| One-click A4 PDF | ✅ |
| Editing a rate or a customer does not change saved quotations | ✅ |
| Works on a phone screen | ✅ (tables become cards; bottom navigation) |
| No technical words in the screens | ✅ |
