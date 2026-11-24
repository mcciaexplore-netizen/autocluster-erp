# Build Prompt: AutoCluster ERP Module 7 (Users, Roles & Sign-in)

The AutoCluster ERP has CRM, Customers, Quotations, Orders & Billing, Planning and Inventory working, live on Vercel with Neon. Today everyone signs in with one shared demo password and is recorded as "Demo User". "Assigned to", "Done by" and "Who's working?" are picked by hand from a names-only team list.

Now add **individual sign-in, roles and permissions**, so that:
- every person has their own account
- each role sees and does only what it should
- every action is recorded against the real person

This is the step that makes the app ready for real use.

Same rules as before:
- Windows, PowerShell syntax for every command.
- Same stack, design system, plain-language UX rules, file storage, auto-refresh rules and Excel patterns.
- When a step needs me, stop, give me short numbered steps in plain words, and wait for "done".
- Never print secrets or passwords in the chat or commit them.
- Work on a new `module7-users` branch, with the page data loader safety test, a local production build before every push, and a commit and push after every phase.
- Test locally and on the Preview copy first. Live changes only in the last phase.

---

## 1. Sign-in approach

- Use **Better Auth** (current stable version) with its Drizzle adapter and our Neon database:
  - email + password sign-in
  - its admin plugin for creating users, roles, banning and sessions
  - the auth tables live in our own database
- **No email service is needed for now.** Admins create accounts and set **temporary passwords**, and users must change theirs at first sign-in. "Forgot password?" says "Ask your admin to reset it." Keep the code ready to add email reset links later.
- Passwords are hashed by the library. Never log them or show them anywhere except the one-time temporary password screen (section 5.2).
- **Sessions:**
  - 7 days with "Keep me signed in", otherwise until the browser closes.
  - Secure, httpOnly cookies.
  - "Sign out", plus "Sign out of all devices" on the profile page.
- **Failed sign-ins:**
  - After 5 wrong passwords for an account, lock it for 15 minutes, with a plain message.
  - Also limit attempts per IP address.
- **Password rules:** at least 10 characters, and not in a common-passwords list. Plain messages, e.g. "Use at least 10 characters."

---

## 2. People: users replace the team list

- **Every existing team member** (Settings > CRM lists > Team members) becomes a **user**. Link them 1:1, so every existing `assigned_to`, `done_by` and `operator_id` keeps working. Additive changes only.
- **Two kinds of user:**
  - **Can sign in:** email, password, roles.
  - **Name only:** for people who never use the app themselves (e.g. a contract operator) but still need to be assigned work. They can be switched to "Can sign in" later.
- The Team members tab in Settings is replaced by the **Users** page (section 5). Show a one-line note where it used to be.

---

## 3. Roles and permissions

### 3.1 Default roles (editable by Admin, section 5.3)

A user can have **several roles**; their permissions add up.

| Area | Admin | Manager | Sales | Accounts | Planner | Operator | Store | Viewer |
|---|---|---|---|---|---|---|---|---|
| CRM | Full | Full | Full except editing stages | View | - | - | - | View |
| Customers | Full | Edit | Edit | View | View | - | - | View |
| Quotations | Full | Full | Create, edit, send, mark Accepted / Rejected | View | View | - | - | View |
| Orders & Billing | Full | Full | View | Full: PO, billing, invoices, payments, reminders | View | - | View | View |
| Planning | Full | Full | View (and the earliest-slot hint) | View | Full, own departments | Today: Start / Pause / Done / Handed over, own departments | View | View |
| Inventory | Full | Full | - | View | Use stock, own departments | Record materials for their own jobs | Full | View |
| Rate Card | Full | Edit | View | View | Edit time and materials | - | View | View |
| Insights | All | All | CRM | Orders and money | Planning | - | Inventory | All |
| Settings, Users, Roles | Full | - | - | - | - | - | - | - |
| **See sale prices** (rates, quotation values, ticket values, "Kept after materials", earnings) | Yes | Yes | Yes | Yes | No | No | No | Yes |
| **See stock costs** (rates, average cost, stock value) | Yes | Yes | No | Yes | No | No | Yes | Yes |

### 3.2 Permission list
- Define every permission in **one file**, `lib/auth/permissions.ts`, grouped by area, each with a plain description for the Roles page. Examples:
  - `crm.view`, `crm.edit`, `crm.stages`, `crm.import`
  - `quotes.edit`, `quotes.status`
  - `orders.po`, `orders.billing`, `orders.payments`, `orders.cancel`
  - `planning.book`, `planning.blocks`, `planning.operate`, `planning.machines`
  - `inventory.receive`, `inventory.use`, `inventory.adjust`, `inventory.count`, `inventory.reorder`, `inventory.items`, `inventory.suppliers`
  - `ratecard.rates`, `ratecard.time_materials`
  - `insights.*`
  - `money.sale_prices`, `money.stock_costs`
  - `settings.edit`, `users.manage`
- **One check for everything:** `can(user, permission, { dept })`.
  - Replace the `canManagePipeline()` placeholder with it.
  - Use it everywhere a permission matters.

### 3.3 Department scope
- Each user has one or more **departments**, or "All departments".
- Permissions marked "own departments" only work on jobs, machines and items of those departments.
  - Example: an RPT operator can't start a PPF job.
  - They can still **view** other departments where the role allows viewing.

### 3.4 Enforcement (most important)
- **Every server action, route handler, file download, Excel export, auto-refresh check and page data loader** checks permission on the server. Hiding buttons is not enough.
- **Money fields are removed on the server** for users without the money permissions. They must never reach the browser, not even hidden in the page data. Show "Hidden" or leave the column out.
- **Navigation** shows only the areas the user can view.
- **Buttons:**
  - A button the user can't use is hidden. Where it helps understanding, it's shown greyed out with a tooltip, e.g. "Only Accounts can record payments".
  - Opening a page without access shows a friendly page: "You don't have access to Inventory. Ask your admin if you need it." with a Home button. Never an error.

---

## 4. Replacing "Demo User" and the pickers

- Every history line, timeline entry, `created_by` and `done_by` now records the **signed-in user**.
- **"Done by"** fills in automatically with the signed-in user.
  - Users with Manager or Admin can change it to record work on someone else's behalf.
  - History then says "Recorded by Meera Iyer for Amit Patil".
- **Today (Planning)** shows the signed-in operator's jobs by default. "Who's working?" stays only for shared devices (section 7) and for Managers / Admins viewing someone else's day.
- **Picker lists filter by role:**
  - "Assigned to" (CRM) lists users with `crm.edit`.
  - Operators (Planning) lists users with `planning.operate` in that department.
  - Name-only users appear where relevant.
- Old records stay as they are. "Demo User" entries stay "Demo User".

---

## 5. Admin pages (Settings)

### 5.1 Users list (`/settings/users`)
- Search, and filters by role, department and status (Active / Deactivated / Name only / Locked).
- Columns: name, email, mobile, roles (chips), departments, status, last sign-in.
- "+ Add user".

### 5.2 Add / edit user

| Field | Rules |
|---|---|
| Full name | Required |
| Can sign in | Switch. Off = name only |
| Email | Required to sign in, unique |
| Mobile | Optional, 10-digit Indian mobile |
| Roles | One or more (checkbox cards with a one-line description of each role) |
| Departments | Chips, or "All departments" |

- **On save (or "Reset password"):**
  - Generate a strong temporary password and show it **once**, with a Copy button and the note "Share this privately. They'll be asked to change it when they first sign in."
  - Never show it again and never store it in plain text.
- **Other actions:**
  - **Deactivate:** they can't sign in, their sessions end immediately, and their history stays.
  - **Reactivate.**
  - **Sign out of all devices.**
- **No deleting** users who appear in any history. Deactivate instead.
- **There must always be at least one active Admin.** Deactivating or removing the Admin role from the last one is refused with a plain message.

### 5.3 Roles (`/settings/roles`)
- List of roles with user counts.
- **Role page:** permissions grouped by area as switches, each with its plain description, plus a "Can only act on their own departments" switch where it applies.
- Actions: **Copy role**, rename, delete (only if no users have it).
- **The Admin role can't lose** Users or Settings permissions.
- Changes apply to everyone's next action, without them having to sign out.
- Log every role change in the Activity log.

### 5.4 Activity log (`/settings/activity`, Admin only)
- Every create, change, delete, status move, stock movement, payment, permission change, sign-in and failed sign-in.
- Each entry has: when, who, area, what, record (with link), and the IP address for sign-ins.
- Filters: user, area, date range.
- "Download as Excel".
- **Write entries from one central helper** used by all server actions.
- Keep the existing per-record histories as they are.

---

## 6. Sign-in page and profile

- **Sign-in page** in the light theme with the ACDRI name:
  - email, password with a "Show" toggle, "Keep me signed in", "Sign in"
  - plain errors: "Email or password is not right." and "Too many tries. Try again in 15 minutes."
- **First sign-in with a temporary password:** a "Choose your new password" screen before anything else.
- **Profile** (avatar menu, top right):
  - name, mobile
  - change password
  - "Signed in on" list of devices with "Sign out of this device", and "Sign out of all devices"
  - their roles and departments (view only)

---

## 7. Shared devices on the shop floor (Today page)

- An Admin can mark a device as **"Shared shop-floor device"** from that device's profile menu. This stores a signed device token.
- **On a shared device, the Today page** shows a grid of operator names for that department.
  - An operator taps their name and enters a **4-6 digit PIN**, set by themselves on their profile, or by an Admin.
  - They're signed in for Today actions only (Start / Pause / Done / Handed over / Record materials).
  - They're signed out automatically after **10 minutes idle** or after their action, whichever comes first.
- **PIN rules:** hashed, locked for 15 minutes after 5 wrong tries, and PIN sign-in only works on devices marked shared.

---

## 8. Demo mode vs real use

- New setting via an environment variable: **`DEMO_MODE=true`** on the demo site (Preview and live demo), **false** for real use.
- **When `DEMO_MODE` is true:**
  - The existing site-wide demo password screen stays as the outer gate.
  - Demo accounts exist for every role (section 10).
  - The sign-in page shows **"Try it as..."** buttons (Admin, Manager, Sales, Accounts, Planner, Operator, Store, Viewer) that sign straight into that demo account.
  - The top bar shows a "Demo: signed in as Operator (Rohan Deshpande)" chip with "Switch role".
- **When `DEMO_MODE` is false:**
  - No demo accounts, no "Try it as..." buttons, no role switching.
  - No outer demo password; individual sign-in only.
  - **`db:reset` and `db:seed` refuse to run against that database**, with a clear message.
  - Add `npm run users:create-admin`: it asks in the terminal for name, email and a password (hidden while typing) and creates the first Admin. It never prints the password.

---

## 9. Database (additive only; live data must not be lost)

- **Better Auth tables** (users, sessions, accounts, verification), with names that don't clash with existing tables.
- **`app_users`:**
  - id, auth_user_id (nullable for name-only), team_member_id (unique link)
  - full_name, email, mobile, can_sign_in, all_departments
  - pin_hash, must_change_password
  - deactivated_at, last_sign_in_at, created_at, updated_at
- `user_departments` (user_id, dept_code)
- `roles`: id, name, description, is_system, scope_own_departments, created_at, updated_at
- `role_permissions` (role_id, permission)
- `user_roles` (user_id, role_id)
- `shared_devices`: id, name, dept_codes, token_hash, created_by, created_at, revoked_at
- `activity_log`: id, user_id, on_behalf_of_user_id, area, action, entity_type, entity_id, summary, data (jsonb), ip, user_agent, created_at (index on created_at, user_id)
- `sign_in_attempts`: id, email, ip, success, reason, created_at

---

## 10. Demo data

Add to `db:seed` / `db:reset` (demo mode only):
- **Demo users:**

| Name | Role(s) | Departments |
|---|---|---|
| Demo Admin | Admin | All |
| Sunita Joshi | Manager | All |
| Neha Kulkarni | Sales | All |
| Vikram Shah | Accounts | All |
| Meera Iyer | Planner, Store | RPT, PPF, MET |
| Amit Patil | Operator | PPF, MET |
| Rohan Deshpande | Operator | RPT |
| Priya Shah | Operator | ENV, RPL |
| Sanjay More | Store | All |
| Board Member | Viewer | All |
| Ravi Contract (name only) | Operator | PPF |

  Amit, Rohan and Priya keep their existing job and booking links. CRM enquiries currently assigned to them move to Neha Kulkarni (and keep a history line).
- **Demo passwords:** generated at seed time and stored only as hashes. "Try it as..." signs in without typing them.
- **Activity log:** a few days of realistic entries.

---

## 11. Build phases (commit and push to `module7-users` after each)

1. **Sign-in foundation:**
   - Better Auth with Drizzle, `app_users` linked to team members, sign-in page, first-sign-in password change, profile.
   - `users:create-admin`.
   - Signed-in user recorded everywhere instead of "Demo User".
   - The outer demo gate kept when `DEMO_MODE` is true.
2. **Permissions engine:**
   - Permission list, default roles, `can()`, department scope.
   - Server-side checks in every action, loader, route, export and file download.
   - Money fields removed on the server.
   - Navigation and button rules, friendly no-access page.
3. **Admin pages:** Users (temporary passwords, deactivate, sign out everywhere), Roles (switches, copy, rules), pickers filtered by role, "Done by" defaults and "Recorded by ... for ...".
4. **Security and the record:** Activity log page and central helper, failed sign-in lockout and IP limits, password rules, sign-in history.
5. **Shared shop-floor devices** with operator PINs on Today.
6. **Demo mode:** demo users, "Try it as...", switch-role chip, `DEMO_MODE` false protections (reset refuses, no demo accounts).
7. **Tests and go live:**
   - Test on the Preview copy.
   - Add `DEMO_MODE=true` and the Better Auth settings to Vercel (Preview and Production). Stop and give me the steps if anything needs me.
   - Back up live, add the new tables, run `db:reset` on live (demo mode); no need to ask.
   - Merge to `main`, check the live site as each role, reset live again so the demo starts clean, and confirm `main` and the branch match.

---

## 12. Done checklist

Tests (Vitest):
- [ ] **Permission matrix test:** call every server action and route as every default role. Each is allowed or refused exactly as in section 3.1. Build the list of actions automatically, so new actions can't be missed.
- [ ] Users without `money.sale_prices` get **no** sale price fields in any page data, export or API response. The same applies to `money.stock_costs`.
- [ ] An RPT operator can't start, pause or finish a PPF job, or use stock for a PPF item.
- [ ] The last active Admin can't be deactivated or lose the Admin role.
- [ ] 5 wrong passwords lock the account for 15 minutes. The right password is refused during the lock.
- [ ] Deactivating a user ends their sessions immediately; their next request goes to the sign-in page.
- [ ] Temporary passwords force a change at first sign-in. Passwords and PINs are stored only as hashes and never appear in logs.
- [ ] History, timelines and the Activity log record the real user, and "Recorded by X for Y" when on behalf of someone.
- [ ] A role permission change applies to that role's users on their next action.
- [ ] PIN sign-in works only on devices marked shared, and signs out after 10 idle minutes.
- [ ] With `DEMO_MODE` false: no demo accounts, no "Try it as...", and `db:reset` / `db:seed` refuse to run.

Browser checks (demo site):
- [ ] **"Try it as Operator" (Rohan Deshpande):**
  - Only Home, Planning (Today, Timeline view) and his RPT jobs.
  - No prices anywhere.
  - Starting a job and recording materials work.
  - Opening `/orders` shows the friendly no-access page.
- [ ] **"Try it as Accounts":** can add a PO, upload an invoice and record a payment, and can't edit the Rate Card.
- [ ] **"Try it as Sales":** can create an enquiry and a quotation and mark it Accepted, and can't see Inventory.
- [ ] **"Try it as Store":** can receive stock and see stock values, and sees no quotation prices.
- [ ] **"Try it as Admin":**
  - Turn off "Record payments" for Accounts, and Vikram's next attempt is refused.
  - Add a user and see the temporary password once.
  - The Activity log shows all of the above.
- [ ] **Shared device:** mark this browser as shared, then on Today pick Amit Patil, enter his PIN, start a job, and see it sign out after the action.
- [ ] Sign-in, profile and admin pages fit a phone-width screen with no sideways scrolling and no technical words.

---

## 13. Final summary for me

In plain words, tell me:
1. What's new and where to find it.
2. How to show the roles in a demo.
3. Exactly what to do before using this for real (turning off demo mode, creating the first Admin, adding real users).
4. Anything that didn't pass or that you had to work around.
5. Any assumptions I should confirm.
