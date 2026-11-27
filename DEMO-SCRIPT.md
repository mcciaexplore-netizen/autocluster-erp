# ERPOne: demo script

About 25 minutes. One story from enquiry to payment, then the shop floor, the store, the admin controls and the plan ahead. Every step says what to click and what everyone should see.

The website is **https://autocluster-erp.vercel.app**. Names in **bold** are buttons, links or headings exactly as they appear on screen.

The demo company is **Demo Manufacturing Co., Pune**, with numbers like DMC/QT/… (quotations), DMC/TK/… (tickets) and DMC/EN/… (enquiries). The top bar shows only the **ERPOne** logo and name.

---

## Before the demo (the same morning)

1. **Reset the demo data**, so jobs are booked for today and nothing from earlier tries is left over. On the Mac, in the project folder:

   ```zsh
   DEMO_COMPANY=generic BLOB_FOLDER=live node --env-file=.env.local.neon node_modules/tsx/dist/cli.mjs scripts/reset.ts
   ```

   - Type `RESET` when asked.
   - It takes about 5 to 8 minutes, and **the website pauses until it finishes**. Don't reset while anyone is using the site.
   - It ends with "Done. The database now holds clean demo data."
   - To show AutoCluster itself instead, use `DEMO_COMPANY=acdri`: the same data with the ACDRI name and ACDRI/… numbers (the numbers in this script then start with ACDRI/ instead of DMC/).
2. **Have the demo password ready.** It's the outer password screen everyone sees first.
3. **Have any small PDF on the laptop** (e.g. a page saved as PDF). Step 2 needs it as the "tax invoice file".
4. **Have a phone or tablet ready** for step 4, the shop-floor tablet. A second browser window also works.
5. **Have the laptop browser at full width**, so the sidebar shows.

---

## 1. Sales: from quotation to order (Neha Kulkarni)

1. Open the website and type the demo password.
2. On the sign-in page, under **Demo: try it as...**, click **Sales**.
   - The top bar shows **Demo: signed in as Sales (Neha Kulkarni)**.
   - The menu has no Inventory. Sales doesn't need it.
3. Click **CRM**. The **Enquiries** board shows every stage: New, Contacted, Negotiation, Won and Lost.
4. Click **+ New enquiry** and fill in:
   - **Enquiry title**: "Fatigue test for brake brackets"
   - **Source**: any
   - **Stage**: New
   - **Company name**, **Contact person** and a 10-digit **Mobile**

   Click **Save enquiry**. A message says **Enquiry … added**.
5. Click **Quotations**, then open **DMC/QT/2026-27/0042** (Sahyadri Auto Components Pvt Ltd, status Sent, ₹8,496).
6. In **Status**, choose **Accepted**, then confirm **Yes, mark Accepted**.
   - A message says the status changed to Accepted and a ticket opened.
   - The page now shows **Locked: tickets opened** with the new ticket number (DMC/TK/2026-27/0302 after a fresh reset). Note it for step 2.

**Point to make:** an accepted quotation turns straight into work. Nobody re-types anything.

## 2. Accounts: PO, invoice and payment (Vikram Shah)

1. Click the amber chip **Demo: signed in as Sales…** (top right) and choose **Accounts**.
2. Click **Orders & Billing**. In the search box, type the **ticket number** you noted in step 1 (e.g. DMC/TK/2026-27/0302). Only that card stays on the board.
3. The ticket is in **Waiting for PO**. On its card, click **Add PO** and fill in:
   - **PO number**: e.g. "SAC/PO/2026/0501"
   - **PO date**: today
   - **PO amount**: 8,496

   Click **Save PO and move to Billing**. The card moves to **Billing**.
4. On the same card, click **Upload tax invoice** and fill in:
   - **Invoice number**: e.g. "DMC/INV/2026-27/0501"
   - **Invoice date**: today
   - **Invoice amount incl. GST**: click **Use selected services' total**
   - **Tax invoice file**: choose your PDF, and wait until it shows as uploaded

   Click **Save invoice and move to Payment**. The card moves to **Payment follow-up**, with its due date.
5. On the card, click **Record payment**. Click **Full amount left**, choose **Bank transfer**, then click **Save payment**. The card moves to **Paid**.
6. Click **Rate Card**: Accounts can see the rates but can't change them.

**Point to make:** each role sees only its own buttons. Sales can't record payments, and Accounts can't change rates.

## 3. Operator: today's work (Rohan Deshpande)

1. Click the chip and choose **Operator**.
   - The menu shows only **Home** and **Planning**, and no prices anywhere.
2. Click **Planning**, then **Today**. Rohan's RPT job for today is there (FDM assembly jigs).
3. On the job, click **Start**.
   - If asked **Which machine are you using?**, click **Start**.
   - The job is now under **Running**.
4. Click **Done**, type a short **Completion note**, then click **Mark done**.
   - If **Record materials now?** appears, click **Record materials**: the usual quantities are filled in. Click **Save stock used**.
5. Type `/orders` in the address bar: a friendly page says **You don't have access to Orders & Billing.**

**Point to make:** operators see their own jobs, in their own departments, and nothing else.

## 4. The shop-floor tablet (Amit Patil, by PIN)

On the phone or tablet (or a second browser window):

1. Open the website, type the demo password, and on the sign-in page click **Admin**.
2. Open the account menu (top right), choose **Profile**, and find **This device**:
   - **Name of this device**: "PPF shop floor tablet"
   - Tap **PPF**
   - Tap **Mark as shared shop-floor device**
3. Open the account menu and choose **Sign out**.
   - The tablet now shows **Who's working?** with the operators' names.
   - The demo note says every operator's PIN is **2580**.
4. Tap **Amit Patil**, type **2580** and tap **Go**. Amit's jobs for today appear.
5. Tap **Start** on his job. The tablet signs him out straight away and shows the names again.

**Point to make:** one tablet for the whole shop floor, no passwords to type, and everything is recorded under the person who did it. To stop sharing the tablet afterwards, sign in as Admin, open **Profile** and tap **Stop sharing this device**.

## 5. Store: stock in (Sanjay More)

Back on the laptop:

1. Click the chip and choose **Store**.
2. Click **Inventory**. The cards show **Stock value**, **Items to reorder**, **Out of stock** and **Expired or expiring**.
3. Click **Stock received** and fill in:
   - **Supplier**: Precision Tools Mart
   - Under **Items received**, choose **Carbide end mill, 6 mm**
   - **Quantity received**: 10
   - **Rate before GST**: e.g. 450

   Click **Save stock received**. The message says **Stock received: …** and gives the record number.
4. Click **Quotations**: Store can't see quotations at all, and on Orders the money columns show **Hidden**.

**Point to make:** store staff see stock values, never sale prices.

## 6. Admin: who can do what (Demo Admin)

1. Click the chip and choose **Admin**. The menu now includes **Settings**.
2. **Change a permission:**
   - Open **Settings**, then **Roles**, then **Accounts**.
   - Under **Orders & Billing**, switch off **Record payments, reminders and follow-ups**, then click **Save role**.
   - The message says **Saved. It applies to everyone with this role straight away.**
   - Switch to **Accounts** with the chip, and open **Orders & Billing**. On any card in **Payment follow-up**, **Record payment** is now greyed out ("Only Accounts can record payments").
   - Switch back to **Admin**, switch the permission on again, and click **Save role**.
3. **Add a person:**
   - **Settings**, then **Users**, then **Add user**.
   - Fill in a **Full name**, keep **Can sign in** on, and give an **Email**, a role (e.g. **Operator**) and a department.
   - Click **Add user**. The **Temporary password** appears once, with **Copy**: "Share this privately… It won't be shown again."
4. **Your company in the top bar (optional):** open **Settings**. Under **Organisation profile**, switch on **Show company name under the logo** and click **Save settings**. The top bar now shows "Demo Manufacturing Co., Pune" under ERPOne. Switch it off again and save.
5. **See the record:** open **Settings**, then **Activity log**. Everything from this demo is listed, newest first, with who did it, when, and a link to the record. Sign-ins show the IP address.

**Point to make:** the Admin decides who can do what, changes apply at once, and everything is on the record.

## 7. The full plan: Coming soon

1. In the sidebar, under **Coming soon (10)**, click a few modules: e.g. **Test Reports**, **Maintenance & Calibration** and **Management Dashboard**.
2. Each page says what it will do and which existing modules it works with, with a faded sketch of the screen. Nothing on these pages works yet. They show where the system is going.

---

## After the demo

- Reset the demo data again (as in "Before the demo") so the next demo starts clean.
- If a phone or tablet was marked as a shared device, it stays shared until someone taps **Stop sharing this device** (Admin, **Profile**) or an Admin taps **Stop** on it under **Settings**, **Users**, **Shared shop-floor devices**.

## If something goes wrong

- **A page shows "You don't have access to…"**: that role isn't allowed there, which is intended. Switch role with the chip.
- **Today shows no jobs**: the demo data wasn't reset today. Reset it (it books each operator's job for the day of the reset).
- **The site seems stuck for a few minutes**: a reset is probably running. Wait for it to finish.
