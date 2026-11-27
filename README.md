# Aurion Desk

Aurion Creative's private operating centre at **desk.aurioncreative.com**: pipeline, inbox,
blueprint, scorecard, platforms register and the 18:00 digest. Phase 1 of three.

Built with Next.js (App Router), TypeScript, Tailwind, Supabase (Postgres, Auth) and Vercel.
Everything Desk stores lives in its own Postgres schema, `desk`.

**How to read this guide.** Do the steps in order. Each step ends with **You know it worked
when**. If that is not what you see, check the troubleshooting table at the end before going
further.

Commands are for PowerShell on Windows. Open PowerShell in the `aurion-desk` folder (in File
Explorer, open the folder, click the address bar, type `powershell`, press Enter).

---

## Contents

1. [Accounts, and where every secret goes](#1-accounts-and-where-every-secret-goes)
2. [Supabase: project, migrations, sign-ups off, RLS check](#2-supabase)
3. [Create the owner and enrol two-factor](#3-create-the-owner-and-enrol-two-factor)
4. [Email: Resend and the sender domain](#4-email-resend-and-the-sender-domain)
5. [Vercel: import, environment variables, deploy](#5-vercel)
6. [DNS: the desk address](#6-dns-the-desk-address)
7. [Cron: confirm the digest and run a test](#7-cron-confirm-the-digest-and-run-a-test)
8. [First use: import the tracker and the blueprint](#8-first-use-import-the-tracker-and-the-blueprint)
9. [Connect the website forms](#9-connect-the-website-forms)
10. [Connect the chatbot](#10-connect-the-chatbot)
11. [Live checklist](#11-live-checklist)
12. [Backups](#12-backups)
13. [How to add a new module](#13-how-to-add-a-new-module)
14. [Troubleshooting](#14-troubleshooting)
15. [Reference: security, modules, Phases 2 and 3](#15-reference)

---

## 1. Accounts, and where every secret goes

You need these accounts. All are free to start except where noted.

| Account | What Desk uses it for | You probably already have it |
|---|---|---|
| GitHub (Astro-tk) | Holds the code, private repository `aurion-desk` | Yes |
| Supabase | Database and sign-in | Yes, but Desk needs a **new project** (see 2.1) |
| Vercel | Runs Desk at desk.aurioncreative.com | Yes |
| Resend | Sends alerts and the daily digest | Yes, aurion-assistant uses it |
| Anthropic | AI lead summaries (optional) | Yes |
| Your domain registrar | DNS for desk.aurioncreative.com | Yes |
| A password manager (for example Bitwarden) | Holds every secret below | If not, install one first |

**The one rule: secrets live in two places only, your password manager and Vercel.** Never in
git, email, WhatsApp, a document, or a screenshot. The `.gitignore` file already stops `.env`
files from being committed.

Make a folder in your password manager called **Aurion Desk** and create one entry per secret
as you go:

| Secret | Where it comes from | Where it goes |
|---|---|---|
| Supabase database password | You set it when creating the project (2.1) | Password manager only |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API Keys | Vercel and `.env.local` |
| `DATABASE_URL` | Supabase > Connect > Session pooler | `.env.local` only (not Vercel) |
| `SESSION_SECRET`, `HASH_PEPPER`, `CRON_SECRET` | You generate them (2.3) | Vercel and `.env.local` |
| `INGEST_SIGNING_SECRET` | You generate it (2.3) | Vercel for Desk **and** Vercel for aurion-assistant |
| `RESEND_API_KEY` | Resend > API Keys (4.2) | Vercel |
| `ANTHROPIC_API_KEY` | console.anthropic.com > API Keys | Vercel |
| Your Desk password | You choose it (3.1) | Password manager only |

**You know it worked when** your password manager has an Aurion Desk folder ready to fill.

---

## 2. Supabase

### 2.1 Create the project

aurion-assistant does not use Supabase (it uses Upstash Redis and Google Sheets), so there is
no existing project to share. Create one; name it for Aurion as a whole so future products can
live beside Desk in their own schemas.

1. Go to https://supabase.com/dashboard and click **New project**.
2. Organisation: yours. Name: `aurion`. Database password: click **Generate a password**, then
   copy it into your password manager as "Supabase database password".
3. Region: **Frankfurt (eu-central-1)** or the closest available to South Africa.
4. Click **Create new project** and wait about two minutes.

**You know it worked when** the project dashboard opens and shows "Project status: Healthy".

### 2.2 Copy the keys

1. Left menu > **Project Settings** (gear icon) > **API Keys**.
2. Copy the **Project URL** (for example `https://abcd1234.supabase.co`) into the password
   manager as `SUPABASE_URL`.
3. Copy the **anon / publishable** key as `SUPABASE_ANON_KEY`.
4. Copy the **service_role / secret** key as `SUPABASE_SERVICE_ROLE_KEY`. This key bypasses all
   security rules. It goes only into Vercel and your `.env.local`, never anywhere else.
5. Top of the dashboard > **Connect** > **Session pooler** tab > copy the URI. Replace
   `[YOUR-PASSWORD]` with the database password from 2.1. Save it as `DATABASE_URL`.

### 2.3 Generate your own secrets

Run this four times in PowerShell; each run prints a new random value:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Save the four values in your password manager as `SESSION_SECRET`, `HASH_PEPPER`,
`INGEST_SIGNING_SECRET` and `CRON_SECRET`. Never change `HASH_PEPPER` once Desk is live:
it is what lets Desk recognise people who asked not to be contacted.

### 2.4 Put the values in .env.local (for running scripts on your computer)

```powershell
npm install
```

```powershell
Copy-Item .env.example .env.local
```

```powershell
notepad .env.local
```

Fill in every value from your password manager, set `OWNER_EMAILS` to the email you will sign
in with, save and close. `.env.local` never leaves your computer.

**You know it worked when** `npm install` ends with "added ... packages" and `.env.local` has
no empty `SUPABASE_` or secret lines.

### 2.5 Run the migrations

```powershell
npm run db:migrate -- --mode production
```

This creates the `desk` schema, every table, every security rule, and the standard lists,
targets and platforms. It keeps its own history in `desk.schema_migrations`, so it never
clashes with anything else in the project. Running it again later only applies new files.

**You know it worked when** you see 16 lines `applying ... done`, then
`This database is now marked as: production`. Check any time with:

```powershell
npm run db:migrate -- --status
```

### 2.6 Let Supabase serve the desk schema

1. **Project Settings > Data API** (on older dashboards: **API > Data API settings**).
2. Under **Exposed schemas**, add `desk` next to `public`. Click **Save**.

This is safe: anonymous visitors have no rights at all on `desk`, and every table requires a
signed-in owner who has passed two-factor.

**You know it worked when** `desk` shows in the Exposed schemas list.

### 2.7 Turn off public sign-ups, and set the sign-in rules

1. **Authentication > Sign In / Providers**. Turn **off** "Allow new users to sign up". Leave
   the **Email** provider on. Click **Save**.
2. **Authentication > Multi-Factor** (or **MFA**): make sure **TOTP (App Authenticator)** is
   enabled.
3. **Authentication > Policies** or **Password Security**: set **Minimum password length** to
   **14**.
4. If you are on the Pro plan: **Authentication > Sessions**: set **Time-box user sessions** to
   `168` hours and **Inactivity timeout** to `12` hours. (Desk enforces both itself anyway, so
   this is a second lock, not a requirement.)

**You know it worked when** "Allow new users to sign up" shows as off.

### 2.8 Confirm Row Level Security is on for every table

1. Left menu > **SQL Editor** > **New query**.
2. Paste this and click **Run**:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'desk' order by 1;
```

**You know it worked when** every row shows `rowsecurity = true` (35 rows, none false).

---

## 3. Create the owner and enrol two-factor

### 3.1 Create your account

```powershell
npm run seed:owner -- --email thato@aurioncreative.com --name "Thato"
```

Use the same email you put in `OWNER_EMAILS`. It asks for a password twice without showing it.
Use at least 14 characters; a short sentence works well. Save it in your password manager.

**You know it worked when** it prints `... is an owner of Aurion Desk.`

### 3.2 Enrol two-factor (after step 5, once Desk is online)

1. Install **Google Authenticator** or **Microsoft Authenticator** on your phone.
2. Open https://desk.aurioncreative.com and sign in with your email and password.
3. Desk shows **Set up two-factor**. Tap **Set up authenticator app**.
4. In the authenticator app, tap **+** > **Scan a QR code** and scan the code on screen.
5. Type the 6-digit code from the app into Desk and tap **Verify**.

**You know it worked when** you land on the **Today** page. From now on every sign-in asks for
the code.

### 3.3 Recovery steps (save these in your password manager now)

- **Best:** add a backup authenticator today. In Desk: **Settings > Profile and two-factor >
  Add a backup authenticator**, and scan with a second device (an old phone, a tablet, or a
  password manager that supports one-time codes).
- **Lost your phone and have no backup:** on your computer, in the `aurion-desk` folder, run:

```powershell
npm run seed:owner -- --email thato@aurioncreative.com --reset-2fa
```

  This removes your authenticators (it needs the service key in `.env.local`). Then sign in
  and enrol again (3.2).
- **Forgot your password:** run `npm run seed:owner -- --email thato@aurioncreative.com` and
  set a new one. Desk has no "forgot password" email on purpose: nobody can reset it from the
  internet.

---

## 4. Email: Resend and the sender domain

aurion-assistant already sends from Resend on `aurioncreative.com`, so the domain is probably
verified. Desk uses the same verified domain.

### 4.1 Check the domain

1. Go to https://resend.com/domains.
2. Find `aurioncreative.com`.

**If it says Verified**, skip to 4.2.

**If it is missing or Pending:** click **Add Domain**, type `aurioncreative.com`, choose a
region, and Resend shows three or four DNS records. In plain words:

- **SPF** (a TXT record, usually on `send.aurioncreative.com`): a public note saying "Resend is
  allowed to send email for this domain". Without it, Gmail treats Desk's emails as suspicious.
- **DKIM** (a TXT record named `resend._domainkey`): a public key. Resend signs every email with
  the matching private key, so receivers can check the email really came from you and was not
  changed.
- **MX** (on `send.aurioncreative.com`): lets bounces come back to Resend. It does not affect
  your normal inbox, because it is on the `send` subdomain only.

Add each record at your DNS host exactly as shown (see 6.1 for how to find it), then click
**Verify DNS Records** in Resend. It can take up to an hour.

### 4.2 Create Desk's own key

1. https://resend.com/api-keys > **Create API Key**.
2. Name: `aurion-desk`. Permission: **Sending access**. Domain: `aurioncreative.com`.
3. Copy the key (shown once) into your password manager as `RESEND_API_KEY`.

**You know it worked when** the domain shows **Verified** and the key appears in the list.

---

## 5. Vercel

### 5.1 Put the code on GitHub

The code is committed locally on the `main` branch. Create the empty private repository and
push to it:

1. Go to https://github.com/new. Owner: **Astro-tk**. Name: `aurion-desk`. Choose **Private**.
   Do **not** add a README, licence or .gitignore. Click **Create repository**.
2. In PowerShell, in the `aurion-desk` folder:

```powershell
git remote add origin https://github.com/Astro-tk/aurion-desk.git
```

```powershell
git push -u origin main
```

**You know it worked when** the repository page on GitHub shows the files and says Private.

### 5.2 Import into Vercel

1. https://vercel.com/new > find `aurion-desk` > **Import**.
2. Framework preset: **Next.js** (detected). Leave the build settings as they are.
3. Open **Environment Variables** before deploying and add every variable below.

### 5.3 Every environment variable

Add each one for **Production** and **Preview**. Values come from your password manager.

| Name | What it is | Where to find it |
|---|---|---|
| `APP_URL` | `https://desk.aurioncreative.com` | Type it |
| `SUPABASE_URL` | Project URL | Supabase > Project Settings > API Keys |
| `SUPABASE_ANON_KEY` | Anon / publishable key | Same page |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role / secret key | Same page |
| `OWNER_EMAILS` | Your sign-in email (comma-separated if more) | Type it |
| `SESSION_SECRET` | Random, 32+ characters | Password manager (2.3) |
| `HASH_PEPPER` | Random, 32+ characters, never change it | Password manager (2.3) |
| `INGEST_SIGNING_SECRET` | Shared with the chatbot | Password manager (2.3) |
| `CRON_SECRET` | Vercel sends it to the cron routes | Password manager (2.3) |
| `INGEST_ALLOWED_ORIGINS` | `https://aurioncreative.com,https://www.aurioncreative.com` | Type it |
| `RESEND_API_KEY` | Sending key | Resend (4.2) |
| `MAIL_FROM` | `Aurion Desk <desk@aurioncreative.com>` | Type it |
| `ALERT_EMAIL_TO` | Optional; where alerts go. Defaults to `OWNER_EMAILS` | Type it |
| `ANTHROPIC_API_KEY` | Optional; AI lead summaries | console.anthropic.com > API Keys |
| `AI_MODEL` | `claude-haiku-5-5` | Type it |
| `WHATSAPP_TOKEN` | Optional; same as aurion-assistant's `WHATSAPP_TOKEN` | aurion-assistant's Vercel variables |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional; same as aurion-assistant's | Same |
| `WHATSAPP_ALERT_NUMBER` | Optional; your number, digits only, like `27821234567` | aurion-assistant's `ALERT_WHATSAPP_NUMBER` |
| `WHATSAPP_ALERT_TEMPLATE` | `new_lead_alert` | aurion-assistant's `ALERT_TEMPLATE_NAME` |
| `DEMO` | `false` | Type it |

Do **not** add `DATABASE_URL` to Vercel; only the scripts on your computer use it.
Leave all four `WHATSAPP_` values empty to skip WhatsApp alerts; Desk then emails only.

### 5.4 Deploy

Click **Deploy**. It takes two to three minutes.

**You know it worked when** Vercel shows "Congratulations" and the preview link opens the Desk
sign-in page (the address will be a `.vercel.app` one until step 6).

### 5.5 Redeploy after changing a variable

Variables only take effect on the next deploy. After any change: **Deployments** > the top
deployment > the **...** menu > **Redeploy** > **Redeploy**.

---

## 6. DNS: the desk address

### 6.1 Find where your DNS is managed

The website runs on GitHub Pages, so DNS is at your domain registrar (the company you pay for
aurioncreative.com). To check, run:

```powershell
Resolve-DnsName aurioncreative.com -Type NS
```

The `NameHost` lines name the DNS host (for example `ns1.afrihost.com` means Afrihost,
`*.cloudflare.com` means Cloudflare). Log in there. It is the same place you added
`api.aurioncreative.com` for the chatbot.

### 6.2 Add the record

1. In Vercel: the `aurion-desk` project > **Settings > Domains** > type
   `desk.aurioncreative.com` > **Add**. Vercel shows a CNAME value, usually
   `cname.vercel-dns.com`.
2. At your DNS host, add a record: Type **CNAME**, Name / Host **desk**, Value / Target the
   value Vercel showed, TTL default. Save.

**You know it worked when** Vercel's Domains page shows a green **Valid Configuration** (from a
few minutes to an hour), and https://desk.aurioncreative.com opens the sign-in page with a
padlock. Now do step 3.2.

---

## 7. Cron: confirm the digest and run a test

`vercel.json` schedules two jobs:

| Job | Schedule (UTC) | South African time | What it does |
|---|---|---|---|
| `/api/cron/digest` | `0 16 * * *` | 18:00 daily | The daily digest email |
| `/api/cron/housekeeping` | `30 1 * * *` | 03:30 daily | Deletes old login attempts and rate-limit counters, rolls renewal dates forward |

1. Vercel > `aurion-desk` > **Settings > Cron Jobs**. Both should be listed and enabled.
2. Test the digest now (use the `CRON_SECRET` from your password manager):

```powershell
$secret = Read-Host "CRON_SECRET"; Invoke-RestMethod -Uri "https://desk.aurioncreative.com/api/cron/digest?date=2000-01-01" -Headers @{ Authorization = "Bearer $secret" }
```

   The `date=2000-01-01` makes this a test digest with its own send key, so tonight's real
   digest still goes out.
3. Run the same command again.

**You know it worked when** the first run returns `delivery: sent` and the email arrives; the
second run returns `delivery: already_sent` and no second email arrives. **Desk > Digest**
shows both runs (succeeded, then skipped).

On Vercel's free Hobby plan, daily jobs can run any time within the scheduled hour, so the
digest may arrive between 18:00 and 18:59.

---

## 8. First use: import the tracker and the blueprint

### 8.1 Check the files on your computer first (optional, saves nothing anywhere)

```powershell
npm run import:pipeline -- ..\Pipeline.csv
```

```powershell
npm run import:blueprint -- ..\Blueprint.md
```

The first prints every problem row. The second prints the task count per section.

### 8.2 The tracker

1. In Google Sheets, open **Aurion Pipeline**, select the tab with the 16 tracker columns
   (Firm, Type, Town, ... Notes), then **File > Download > Comma-separated values (.csv)**.
   Note: `Pipeline.csv` in this folder is the dropdown lists tab, not the tracker; Desk will
   refuse it and say so.
2. Desk > **Pipeline > Import CSV** > choose the file > **Check the file**.
3. Read the report. Every row with an error is listed with the column and the reason. Fix
   those rows in the sheet, download again, and check again. Rows marked Skip are people
   already in Desk (same email); they are never overwritten.
4. When the report shows no errors, click **Import**.

**You know it worked when** it says "Imported N leads and M consent records", and the Pipeline
shows them. Consent from the Consent column is stored with evidence "import".

### 8.3 The blueprint

1. Desk > **Blueprint > Re-import** (or **Import blueprint.md** the first time) > choose
   `Blueprint.md` > **Show me the changes**.
2. Check the table: 189 tasks, 77 with a due date (1 to 24 Dec 2026).
3. Click **Apply these changes**.

**You know it worked when** the Blueprint page shows each section with its progress bar, and
**Today** lists the day's run-sheet tasks. To update the plan later, edit the markdown and
re-import: Desk shows new, reworded and removed tasks first, and keeps your ticks.

---

## 9. Connect the website forms

The branch `desk-forms` in Astro-tk/newaurionsite makes the homepage contact form, the pricing
enquiry form and the contact page form also send a copy to Desk, and adds an unticked box:
"Aurion may contact me about this enquiry." Formspree stays the main destination: if Desk is
down, nothing changes for the visitor.

1. Open https://github.com/Astro-tk/newaurionsite/pull/new/desk-forms and click **Create pull
   request**. Read the **Files changed** tab.
2. Click **Merge pull request** > **Confirm merge**. GitHub Pages updates in a few minutes.
3. Open https://aurioncreative.com/contact.html in a private browser window and send a real
   test: your name with "TEST", your email, tick the box, a short message.

**You know it worked when** the message arrives by Formspree as before **and** appears in
Desk's **Inbox** within a few seconds, with "Consent ticked". Dismiss it with reason "test".

---

## 10. Connect the chatbot

The branch `desk-ingest` in Astro-tk/aurion-assistant sends each consented, scored lead to
Desk, signed with `INGEST_SIGNING_SECRET`. The Google Sheet keeps working
(`SHEET_SYNC_ENABLED`, on by default) until you retire it.

1. Vercel > the **aurion-assistant** project > **Settings > Environment Variables** > add
   `INGEST_SIGNING_SECRET` with **exactly** the same value as in Desk. Production and Preview.
2. Open https://github.com/Astro-tk/aurion-assistant/pull/new/desk-ingest > **Create pull
   request** > read it > **Merge pull request** > **Confirm merge**. Vercel deploys it.
3. If you added the variable after the deploy started, redeploy aurion-assistant (5.5).
4. Have a test chat on the site: say you need help with BOQs, say **yes** to the consent
   question, and give a test email.

**You know it worked when** the chat lead appears in Desk's Inbox with its score. If the score
is 4 or more you get two alerts for now: one from the chatbot, one from Desk. When Desk's alert
arrives reliably, set `CHATBOT_ALERTS_ENABLED=false` on aurion-assistant and redeploy it.

To test both endpoints at once from your computer (creates real Inbox items named "Desk test"):

```powershell
npm run ingest:test -- --url https://desk.aurioncreative.com
```

Every row should say PASS.

---

## 11. Live checklist

Tick each one on the live site. Use a private browser window for the last two.

| # | Check | How | Passes when |
|---|---|---|---|
| 1 | A form lands in the Inbox | Step 9.3 | Item appears with the form name |
| 2 | A chatbot lead lands with its score | Step 10.4 | Item shows "Score n/5" |
| 3 | The alert email arrives | A chatbot lead scoring 4 or 5 | Email "New lead: ... (score 4/5)" within a minute |
| 4 | The 18:00 digest arrives | Wait for 18:00 (Hobby: by 18:59) | One email "Aurion Desk, ..." |
| 5 | Logged out, every page sends you to sign-in | Private window: open https://desk.aurioncreative.com/pipeline | You land on /login |
| 6 | A login without 2FA cannot see data | Private window: sign in with the password, then on the code screen change the address to /pipeline | You are sent back to the code screen; nothing loads |
| 7 | Bio link clicks are counted | On your phone, open https://aurioncreative.com/links?via=ig and tap WhatsApp | Desk > **Bio links** shows 1 view and 1 click from Instagram within a few seconds |

Also check: https://desk.aurioncreative.com/robots.txt shows `Disallow: /`.

### Bio links (aurioncreative.com/links)

Full guide: [docs/BIO-LINKS.md](docs/BIO-LINKS.md) (the links, how it works, privacy, editing the
page, the endpoint, testing, troubleshooting). In short:

The page lives in the website repository (`links.html`, branch `bio-links`). Merge that branch
on GitHub the same way as step 9; it works even before Desk is live (clicks are simply not
counted until then). Then put one link in each bio, so Desk can tell which platform sent the
visitor. **Desk > Bio links** lists the exact link for each platform:

| Platform | Link |
|---|---|
| Instagram | `https://aurioncreative.com/links?via=ig` |
| LinkedIn | `https://aurioncreative.com/links?via=li` |
| Facebook | `https://aurioncreative.com/links?via=fb` |
| YouTube | `https://aurioncreative.com/links?via=yt` |
| TikTok | `https://aurioncreative.com/links?via=tt` |
| WhatsApp Business profile | `https://aurioncreative.com/links?via=wa` |
| Email signature | `https://aurioncreative.com/links?via=email` |
| QR code on the one-pager | `https://aurioncreative.com/links?via=qr` |

Counting is cookieless: Desk keeps no IP address and no personal data, only a visitor code
that changes every day, and the page sends nothing when a browser asks not to be tracked.
**Book a Workflow Audit** opens a short form on the page itself (the same Formspree form as the
contact page). Its Desk copy arrives in the Inbox as form `bio` with `links?via=ig` (or similar)
in the page address, so you can see which bio produced the lead.
To change a link on the page, edit its `<a>` in `links.html`; keep its `data-link` value the same
so its history in Desk carries on.

---

## 12. Backups

- **What Supabase keeps:** this depends on your plan, so look at **Database > Backups** in
  your project. Paid plans keep daily backups you can restore from there (Pro: 7 days at the
  time of writing). The Free plan offers no restorable backups and can pause a project that is
  not used for a while (Desk's daily cron jobs keep it in use). Treat your own monthly export
  below as the backup you can rely on.
- **Your own backup, monthly:** Desk > **Settings > Data export > Download the ZIP**. It holds
  every table as CSV. It contains personal information: store it in your password manager's
  secure files or on an encrypted drive, never in email or plain cloud storage.
- **The reminder:** the Platforms register has a row **Monthly backup export** with a renewal
  date. It shows on Today and in the digest two weeks before, and moves on a month by itself.

---

## 13. How to add a new module

Example: turning on the Phase 2 `analytics` module.

1. **Folder.** `src/modules/analytics/` already has `index.ts` (its registry entry). Add:
   - `routes/AnalyticsPage.tsx`: the page (call `requireMember()` first);
   - `queries.ts`: reads through `userDb()` so Row Level Security applies;
   - `actions.ts`: `'use server'` actions; each one Zod-parses its input and calls
     `requireCapability(...)` first.
2. **Permissions.** Add capabilities (for example `analytics.read`) to
   `src/lib/auth/permissions.ts`, then run `npm run gen:capabilities`. That writes a new
   migration for `desk.role_capabilities`.
3. **Tables.** Add a new numbered file in `db/migrations/` (next number). Every table needs
   `enable row level security` and policies that call `desk.can('analytics.read')`. Never edit
   an applied migration. Run `npm run db:migrate`, then `npm run db:schema`.
4. **Route.** Add `src/app/(desk)/analytics/page.tsx` with one line:
   `export { default } from '@/modules/analytics/routes/AnalyticsPage';`
5. **Registry.** In `src/modules/analytics/index.ts` change `status: 'later'` to
   `status: 'live'` and set `capability: 'analytics.read'`. The sidebar updates itself.
6. **Optional:** add `home: () => import('./home')` for a card on Today, and
   `digest: () => import('./digest')` for a section in the 18:00 email.
7. Run `npm test`. The security tests find the new page automatically and check that a
   signed-out visitor and a password-only (no 2FA) session cannot reach it.

---

## 14. Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| "Aurion Desk is not configured" | A Supabase variable, `SESSION_SECRET` or `OWNER_EMAILS` is missing in Vercel | Add it (5.3), then redeploy (5.5) |
| "That email and password do not match" with the right password | Email not in `OWNER_EMAILS`, or the account was never created | Check `OWNER_EMAILS`; run 3.1 |
| "Too many attempts" | 5 wrong passwords in 15 minutes | Wait 15 minutes |
| Signed in, but every page bounces to sign-in | Session cookie blocked, or `SESSION_SECRET` changed | Allow cookies for the site; sign in again |
| Pages load but show no data | `desk` not in Exposed schemas, or migrations not run | Steps 2.6 and 2.5 |
| "DEMO=false but this database is marked demo" (or the reverse) | `DEMO` disagrees with the database | Set `DEMO` to match the database you point at |
| Migration says a file "was changed after it was applied" | An applied migration was edited | Undo the edit; put changes in a new numbered file |
| Website form shows success but nothing in the Inbox | `desk-forms` not merged, or origin not allowed | Merge (step 9); check `INGEST_ALLOWED_ORIGINS` has both addresses |
| Chatbot leads not arriving, Vercel logs show "Desk 401" | Signing secrets differ, or a clock is badly wrong | Paste the same `INGEST_SIGNING_SECRET` into both projects; redeploy both |
| No alert emails | `RESEND_API_KEY` missing, or domain not verified | Steps 4.1 and 4.2; check **Digest > Recent sends** for the error |
| WhatsApp alert never comes | One of the `WHATSAPP_` values missing, or the template not approved | Copy the values from aurion-assistant; check Meta > Message templates |
| Accepted an item but no "AI draft" | No `ANTHROPIC_API_KEY`, or the API was busy | Optional feature; add the key, or write the next action yourself |
| Digest did not arrive | Cron off, wrong `CRON_SECRET`, or email failure | Vercel > Cron Jobs; Desk > Digest shows the run and any error |
| Blueprint import "is a Tue, not a Wed" | A run-sheet heading has the wrong weekday | Fix the heading in the markdown and import again |
| Lost the authenticator phone | No backup factor | Step 3.3 |

---

## 15. Reference

### Security in one page

- **Sign-in:** email and password (14+ characters), then a TOTP code, every time. Only emails in
  `OWNER_EMAILS` are even tried. Public sign-up is off. 5 failures for one email in 15 minutes
  locks it for 15 minutes; 20 from one IP in an hour locks that IP.
- **Two-factor is enforced three times:** the proxy (`src/proxy.ts`) lets a password-only
  session reach only the 2FA screen; every database policy requires `aal2` in the session; and
  every server action checks `requireCapability`.
- **Sessions** end 7 days after sign-in, or after 12 hours without activity.
- **Public surface:** `/login`, `/login/2fa`, `/api/ingest/form`, `/api/ingest/chatbot`,
  `/api/ingest/event` (bio-page views and clicks: origin allowlist, 2 KB limit, rate limit, bots
  dropped, Do Not Track and GPC honoured) and `robots.txt`. The cron routes need `CRON_SECRET`.
  Everything else needs a full session.
- **Roles:** `owner` now; `viewer` and `assistant` reserved. Every rule is in
  `src/lib/auth/permissions.ts`; the database copy is generated from it and a test fails if
  they drift.
- **Row Level Security** on every `desk` table. The anon key has no rights at all on `desk`.
  The service key is used only in server code (ingest, cron, sign-in bookkeeping, scripts).
- **Headers:** a per-request nonce Content-Security-Policy, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, HSTS, `X-Robots-Tag: noindex, nofollow`.
- **Audit log:** append-only, records every create, update, delete, sign-in, 2FA event, export
  and deletion, with who and when. It stores column names, never values, so it holds no
  personal data.
- **POPIA:** consent records are append-only and the latest one counts; a "no" blocks logging or
  drafting outbound messages (in the app and in the database). Settings > Danger zone deletes a
  person's personal data and keeps an anonymous trail.

### Modules and where they live

| Module | Routes | Main tables | Events |
|---|---|---|---|
| Today | `/` | (cards from other modules) | |
| Pipeline | `/pipeline`, `/pipeline/new`, `/pipeline/[id]`, `/pipeline/import`, `/pipeline/export` | organisations, contacts, leads, stage_history, consent_records, activities, saved_views | lead_created, stage_changed, consent_recorded, activity_logged, pipeline_imported |
| Inbox | `/inbox`, `/inbox/[id]`, `/api/ingest/*` | inbox_items, notifications | form_submitted, chatbot_lead_received, inbox_accepted, inbox_dismissed, ai_draft_created, alert_sent |
| Blueprint | `/blueprint`, `/blueprint/import` | blueprint_documents, blueprint_sections, tasks | blueprint_imported, task_done, task_reopened, task_created |
| Scorecard | `/scorecard`, `/scorecard/december` | targets, scorecard_entries | scorecard_entered |
| Platforms | `/platforms`, `/platforms/[id]` | platforms | |
| Digest | `/digest`, `/api/cron/*` | job_runs, notifications | |
| Bio links | `/links`, `/api/ingest/event` | events (source website), via `desk.link_stats()` | link_page_view, link_click |
| Settings | `/settings`, `/settings/export` | lists, members, audit_log | export_created, contact_forgotten |

### Commands

| Command | What it does |
|---|---|
| `npm test` | Every test (security, RLS, imports, ingest, digest, POPIA delete) on an in-memory database |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply new migrations (`--status` to list, `--mode` on first run) |
| `npm run db:schema` | Rebuild `db/schema.sql` from the migrations |
| `npm run gen:capabilities` | New migration from `permissions.ts` |
| `npm run seed:owner -- --email ...` | Create the owner, set a password, or `--reset-2fa` |
| `npm run seed:demo` | Fictional data, only on a database marked demo |
| `npm run import:pipeline -- file.csv` | Local dry run of a tracker CSV |
| `npm run import:blueprint -- file.md` | Local blueprint parse and task count per section |
| `npm run ingest:test` | Test payloads to both ingest endpoints (`--url` for the live site) |

### Demo mode

For screenshots: create a separate Supabase project, run `npm run db:migrate -- --mode demo`
against it, then `npm run seed:demo`, and deploy with `DEMO=true`. Desk shows a "Demo data" tag
and refuses to start if `DEMO` and the database disagree, so demo and real data never mix.

### How Phases 2 and 3 fit

Nothing in Phase 1 needs rewriting for these. Each is a folder in `src/modules`, already listed
in the registry as "Coming later".

| Module | Tables it will use | New tables | Events it reads or writes | Interface |
|---|---|---|---|---|
| **analytics** (P2) | events (indexed on time, source+type, subject, and `anon_id`) | none to start; a monthly rollup if page views grow | writes `page_view` (source website, cookieless `anon_id`, no personal data, honours Do Not Track); reads `form_submitted`, `lead_created`, `stage_changed` for funnels and attribution. The bio-links endpoint (`/api/ingest/event`, `src/integrations/website-events`) is its first piece: extend its event types rather than adding a second endpoint | AnalyticsSource |
| **docs** (P2) | blueprint_documents (source markdown already stored) | documents (with a full-text search column); Supabase Storage bucket | `doc_uploaded` | none |
| **ai** (P2) | leads (`summary`, `summary_is_ai_draft`, `ai_model` already exist), activities, scorecard_entries, consent_records | ai_drafts | `ai_draft_created`; must call `assertMayContact()` before any reply draft | AIProvider (built) |
| uptime and hours (P2) | events, targets (`hours_worked` target exists, cap 10) | hours_log | `monitor_status` (source system) | AnalyticsSource |
| **social** (P3) | events | social_posts | `social_metric` per post | AnalyticsSource (YouTube, Instagram); CSV import for LinkedIn |
| **experiments** (P3) | leads, activities, events | experiments, experiment_assignments | `variant_assigned`, reply events; a minimum sample before any winner shows | none |
| **money** (P3) | platforms (costs), leads (Signed, Founding Office) | invoices, ledger_entries (all in cents) | `invoice_sent`, `payment_received` | none |

If page views pass a few million rows, move `desk.events` to monthly partitions; the indexes
are already shaped for it.
