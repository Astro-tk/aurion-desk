# Bio links

One link for every social bio: **https://aurioncreative.com/links**. A retro terminal page in the
Aurion colours, with every view and every tap counted in Aurion Desk, cookieless, and shown on
**Desk > Bio links**.

It replaces the old Linktree (linktr.ee/aurioncreative), which had two buttons: Website and
Instagram.

---

## Contents

1. [The links to paste in each bio](#1-the-links-to-paste-in-each-bio)
2. [What is on the page](#2-what-is-on-the-page)
3. [How it works](#3-how-it-works)
4. [Privacy (POPIA)](#4-privacy-popia)
5. [Going live](#5-going-live)
6. [Reading the numbers in Desk](#6-reading-the-numbers-in-desk)
7. [Changing the page](#7-changing-the-page)
8. [Technical reference](#8-technical-reference)
9. [Testing](#9-testing)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. The links to paste in each bio

All of them open the same page. The `?via=` part tells Desk which bio the visitor came from.

| Put it on | Link |
|---|---|
| Instagram bio | `https://aurioncreative.com/links?via=ig` |
| LinkedIn (profile and company page) | `https://aurioncreative.com/links?via=li` |
| Facebook | `https://aurioncreative.com/links?via=fb` |
| YouTube channel | `https://aurioncreative.com/links?via=yt` |
| TikTok | `https://aurioncreative.com/links?via=tt` |
| WhatsApp Business profile | `https://aurioncreative.com/links?via=wa` |
| Email signature | `https://aurioncreative.com/links?via=email` |
| QR code on the one-pager | `https://aurioncreative.com/links?via=qr` |

Desk > Bio links shows this same table, ready to copy.

**Where to paste it**

- **Instagram:** profile > **Edit profile** > **Links** > **Add external link**. Remove the old
  Linktree link.
- **LinkedIn:** your profile > **Contact info** (pencil) > **Website**, type "Other", paste.
  Company page: **Edit page** > **Website URL** (use the `?via=li` link there too).
- **WhatsApp Business:** **Settings** > **Business tools** > **Business profile** > **Website**.
- **Email signature:** link the words "aurioncreative.com/links" to the `?via=email` link.

Short version for print, where nobody can tap: `aurioncreative.com/links`. Visits without
`?via=` are still counted, as "Direct" or by the site they came from.

---

## 2. What is on the page

| # | Button | Goes to | Name in Desk |
|---|---|---|---|
| 01 | Book a Workflow Audit (lime, first) | Opens the enquiry form right there on the page (see below) | `audit` when opened, `audit-sent` when sent |
| 02 | Website | aurioncreative.com | `website` |
| 03 | Project Command | aurioncreative.com/project-command.html | `project-command` |
| 04 | BeeLevel | aurioncreative.com/beelevel.html | `beelevel` |
| 05 | Pricing | aurioncreative.com/index.html#pricing | `pricing` |
| 06 | Message us on WhatsApp | wa.me/27655465919, with a first message filled in | `whatsapp` |
| Key | LinkedIn | linkedin.com/company/aurioncreative | `linkedin` |
| Key | Instagram | instagram.com/aurion_creative | `instagram` |
| Key | Email | info@aurioncreative.com | `email` |
| Key | Call | +27 65 546 5919 | `call` |

### The audit form

Tapping **Book a Workflow Audit** folds open a short form under the button, so nobody leaves
the page. It grows as it is filled in, one step at a time, with a small 0/4 to 4/4 meter:

1. **Your name.** The cursor lands here as soon as the panel opens.
2. **Email** appears once the name is typed (two letters or more).
3. **What do you need?** (preset to Workflow Audit) and **the work to take off your team**
   appear once the email is a complete address.
4. **WhatsApp number** (optional) and the unticked consent box "Aurion may contact me about
   this enquiry." appear once they start writing.

**SEND** appears last, below everything, once the name, email and message are filled in and
the visitor has moved on from the message (tapped out of it, or into the number or consent
box). It never pops up while they are still typing. Until then, Enter (Go or Next on a phone
keyboard) moves to the next field instead of sending.

It is **the same form as the contact page**: it posts to the same Formspree form
(`xjgqqjdo`) with the same field names (`name`, `email`, `phone`, `service`, `message`,
`consent`, and the `_gotcha` honeypot), so every enquiry still arrives in the same Formspree
inbox. The only difference is the email subject, "New enquiry from aurioncreative.com links
page", so you can tell where it came from. As on the website, a copy also goes to the Desk
Inbox (shown as form `bio`, with the page address `links?via=ig` or similar).

After sending, the form is replaced by "Thanks, we have your message. Expect a reply within
24 hours." and a WhatsApp link. If Formspree cannot be reached, an error message offers
info@aurioncreative.com and everything typed stays in place to try again. Without JavaScript,
the panel still opens and shows the whole form, which posts straight to Formspree.

Also on the page: the Aurion icon, "Engineering meets software.", the studio line from the
website, and a ticker with the Founding Office offer (40% off setup, three places, closes
31 Mar 2027). The wording matches the website, so the two never disagree.

**The look:** a retro computer terminal on the dark canvas (#1F2A2E) with lime (#C1FF72) as the
only accent. Pixel display type (Press Start 2P), a mono body face (IBM Plex Mono), a faint
blueprint grid, soft scanlines, a blinking lime cursor, and chunky buttons with hard shadows
that press in when tapped. Visitors whose phones ask for reduced motion get no blinking and no
scrolling ticker. It is built for one-handed use on a phone: the main buttons are at least
60 px tall, the keys are large thumb targets, and nothing scrolls sideways.

---

## 3. How it works

```
Instagram bio
   |  taps aurioncreative.com/links?via=ig
   v
links.html (GitHub Pages, aurioncreative.com)
   |  on load:  {"t":"view", "page":"bio", "via":"ig"}
   |  on tap:   {"t":"click", "link":"whatsapp", "label":"WhatsApp", "page":"bio", "via":"ig"}
   |  sent with navigator.sendBeacon (still delivered while the next page opens)
   v
Desk: POST /api/ingest/event (desk.aurioncreative.com)
   |  checks origin, size, rate, bots, Do Not Track; validates; works out the source and device
   v
desk.events (source "website", type link_page_view or link_click)
   |
   v
desk.link_stats()  ->  Desk > Bio links, the Today card, and the 18:00 digest
```

**From a tap to a lead.** The audit form sits on the page itself. When the visitor sends it,
Formspree receives it exactly like a contact-page enquiry, and the copy that reaches the Desk
Inbox is marked form `bio` with the page address (`links?via=ig`), so you can see which bio
produced the enquiry. Desk also counts two clicks: `audit` when the form is opened and
`audit-sent` when it is sent, so Bio links shows how many people who opened it finished it.

**If Desk is down or not deployed yet,** the page works normally; that visit is simply not
counted. Counting can never slow the page down or stop a link from opening.

---

## 4. Privacy (POPIA)

- **No cookies and no local storage.** The page stores nothing on the visitor's phone.
- **Nothing personal is collected.** The page sends only which page, which button, the `via`
  value and the referring site.
- **Desk never stores the IP address or the browser details.** It keeps only:
  - a **visitor code**: a keyed hash of IP address, browser and date, cut to 16 characters. It
    changes every day and cannot be turned back into an IP, so Desk can count "visitors today"
    but cannot follow anyone from one day to the next;
  - the **referring site's name only** (for example `l.instagram.com`), never the full address,
    which can carry personal details in it;
  - the **source** (instagram, linkedin and so on) and the **device type** (mobile, tablet,
    desktop).
- **Do Not Track and Global Privacy Control are honoured twice:** the page sends nothing, and
  Desk discards anything that arrives with either signal.
- **Bots and link previews are discarded** (WhatsApp and Facebook previews, crawlers, scripts).
- The page says "No cookies. Visits are counted without any personal data." and links to the
  privacy notice. Because no personal information is processed, no consent box is needed; the
  enquiry form keeps its own consent box.

---

## 5. Going live

The page and the counting live in two repositories. Both changes are on the `bio-links`
branch and merged into `main`.

1. **Website:** merging into `main` publishes the page through GitHub Pages within a few
   minutes. Open https://aurioncreative.com/links on your phone.
   **You know it worked when** the terminal page loads with the Aurion icon.
2. **Desk:** the endpoint and the Bio links screen go live with Desk itself (Desk README
   step 5). Desk needs no new settings: it uses `INGEST_ALLOWED_ORIGINS` and `HASH_PEPPER`,
   which are already set. Run `npm run db:migrate` once so the new migration
   `0016_link_stats.sql` is applied.
   **You know it worked when** `npm run db:migrate -- --status` shows nothing pending.
3. **Test the counting:** on your phone, open `https://aurioncreative.com/links?via=ig` and
   tap **Message us on WhatsApp**.
   **You know it worked when** Desk > Bio links shows 1 view and 1 click from Instagram within a
   few seconds.
4. **Swap the bios:** paste the links from section 1. Keep the old Linktree for a week, then
   delete it from Linktree's account settings once the new link is everywhere.

---

## 6. Reading the numbers in Desk

**Desk > Bio links** (also on the left menu):

| What | What it means |
|---|---|
| Page views | Every time the page was opened |
| Visitors | Different people per day (one person opening it three times on Tuesday counts once on Tuesday) |
| Link clicks | Every tap on a button or key |
| Click rate | Clicks divided by views. Watch its trend: a falling rate means the page or the bio needs a sharper first button |
| Day by day | Outline bars are views, lime bars are clicks |
| Clicks by link | Which buttons people actually want. Move the popular ones up |
| Where visitors came from | Views, clicks and click rate per platform: which bio earns its place |

Switch between the last 7, 30 and 90 days at the top. **Today** shows the last 7 days in one
card, and the **18:00 digest** includes a "Bio links today" section on days with visits.

**Reading it for decisions.** If one platform brings many views but few clicks, its audience is
browsing rather than buying. If "Book a Workflow Audit" gets fewer clicks than "Pricing", people
want the numbers first, so lead with pricing in posts. Compare "Book a Workflow Audit" (opened)
with "Workflow Audit form sent": a big gap means the form is losing people. Check the Inbox for
form `bio` enquiries to see which platform produces real leads, not just taps.

---

## 7. Changing the page

Everything is in one file, `links.html`, in the website repository.

**Change a button's text or destination:** edit its `<a>` tag. Keep its `data-link` value the
same, so its history in Desk carries on.

```html
<a class="btn" data-link="pricing" data-label="Pricing" href="https://aurioncreative.com/index.html#pricing">
```

- `data-link`: the short, stable name Desk counts by. Lower-case letters, numbers and `-` only,
  up to 40 characters.
- `data-label`: the name Desk shows. Change it freely.

**Change the audit form:** it is the `<details class="audit">` block. Keep the field `name`
attributes as they are, because they must match the contact page's Formspree form. The steps are
the `<div class="step">` blocks; the script reveals each one when the one before is filled in
(the rules are in `ready()` near the end of the file). To change the service list, edit the
`<select>`, keeping it the same as the contact page's.

**Add a button:** copy one `<li>...</li>` block in the list, give it a new `data-link`, a
`data-label`, the next number in `<span class="idx">`, and the destination. When the BOQ Checker
goes live (8 Dec), add it as 02:

```html
<li>
  <a class="btn" data-link="boq-checker" data-label="BOQ Checker" href="https://aurioncreative.com/boq-checker">
    <span class="idx">02</span>
    <span class="txt"><strong>Check a BOQ free</strong><small>Arithmetic, missing rates and units, in two minutes</small></span>
    <span class="arrow" aria-hidden="true">&gt;</span>
  </a>
</li>
```

**Add a platform:** make up a short `via` value (for example `?via=threads`). Desk shows any
unknown value under its own name. To give it a friendly name and add it to the copy table in
Desk, add it to `SHARE_LINKS` and `SOURCE_LABELS` in
`aurion-desk/src/modules/links/queries.ts`.

**Change the icon:** replace `assets/images/logos/aurion-icon.png` (240 x 240 px PNG).

**When the Founding Office closes or fills,** change or delete the `.ticker` block.

The page is standalone: it has no shared header and footer, and `scripts/check_partials.py`
skips it because `<body>` carries `data-standalone-page`. Keep that attribute.

---

## 8. Technical reference

### Files

| Repository | File | What it does |
|---|---|---|
| newaurionsite | `links.html` | The page, its styles and the counting script |
| newaurionsite | `assets/images/logos/aurion-icon.png` | The icon in the lime tile |
| newaurionsite | `assets/js/desk-ingest.js` | Keeps `from` and `via` in the form copy sent to Desk |
| newaurionsite | `scripts/check_partials.py` | Skips pages marked `data-standalone-page` |
| aurion-desk | `src/integrations/website-events/index.ts` | Event schema, source and device detection, visitor code, bot filter |
| aurion-desk | `src/modules/links/event-handler.ts` | The endpoint's checks, in order |
| aurion-desk | `src/modules/links/routes/event-route.ts` | Wires the handler to rate limiting and `desk.events` |
| aurion-desk | `src/app/api/ingest/event/route.ts` | The public route |
| aurion-desk | `db/migrations/0016_link_stats.sql` | `desk.link_stats()` and an index |
| aurion-desk | `src/modules/links/*` | The Bio links screen, Today card, digest section, share links |
| aurion-desk | `tests/links.test.ts` | Endpoint, sources, visitor code and stats tests |

### The endpoint: `POST https://desk.aurioncreative.com/api/ingest/event`

Body (JSON, sent as `text/plain` by `sendBeacon`, at most 2 KB):

| Field | Required | Rules |
|---|---|---|
| `t` | yes | `view` or `click` |
| `page` | no | Defaults to `bio`. Letters, numbers, `-`, `_`; up to 30 |
| `link` | for clicks | Letters, numbers, `-`, `_`; up to 40 |
| `label` | no | Up to 80 characters |
| `via` | no | Up to 30. Aliases: ig, li, fb, yt, tt, x, wa, email, qr |
| `ref` | no | The referring address; Desk keeps only its host name |

Checks, in this order:

| Check | Answer if it fails |
|---|---|
| Method is POST (OPTIONS answers CORS for allowed origins) | 405 |
| `Origin` is `https://aurioncreative.com` or `https://www.aurioncreative.com` (`INGEST_ALLOWED_ORIGINS`) | 403 |
| Body at most 2 KB | 413 |
| `DNT: 1` or `Sec-GPC: 1` | 204, nothing stored |
| Bot or preview user agent, or none | 204, nothing stored |
| At most 60 events a minute per IP (keyed hash) | 429 |
| Valid JSON matching the rules above | 422 |
| Stored | 204 |

The endpoint is part of Desk's public surface, with the form and chatbot endpoints; the access
test in `tests/auth.test.ts` lists it explicitly.

### What is stored

One row in `desk.events` per view or click:

| Column | View | Click |
|---|---|---|
| `source` | `website` | `website` |
| `type` | `link_page_view` | `link_click` |
| `subject_type` / `subject_id` | `link_page` / `bio` | `link` / the `data-link` value |
| `anon_id` | daily visitor code | daily visitor code |
| `payload` | `page`, `via` (normalised), `ref_host`, `device` | the same, plus `label` |

Sources are worked out as `?via=` first (with the aliases), then the referring site (Instagram,
LinkedIn and lnkd.in, Facebook, YouTube, TikTok, X and t.co, WhatsApp, search engines,
aurioncreative.com), otherwise `direct`.

### `desk.link_stats(from, to, page default 'bio')`

Returns one JSON object: `views`, `visitors`, `clicks`, `clickers`, `by_link` (link, label,
clicks), `by_source` (source, views, clicks), `by_device` and `by_day` (South African dates). It
runs as the signed-in member, so Row Level Security applies: anyone without `events.read` (or a
session without 2FA) gets zeros.

### Phase 2

This is the first piece of the Phase 2 analytics module: the same endpoint, event store and
visitor code will carry page views from the whole website. Extend
`src/integrations/website-events` with new event types rather than adding a second endpoint.

---

## 9. Testing

In `aurion-desk`:

```powershell
npm test
```

`tests/links.test.ts` covers: views and clicks stored with source and device; the referrer's
query never stored; foreign or missing origins refused; Do Not Track, GPC and bots discarded;
size, JSON, shape and link-name validation; rate limiting; `?via=` aliases and referrer sources;
the visitor code changing daily and never containing the IP; and `desk.link_stats()` totals,
visitors per day, breakdowns, and zeros for a session without 2FA.

To look at the page on your computer before publishing, in the `newaurionsite` folder:

```powershell
python -m http.server 8099
```

Then open http://localhost:8099/links.html?via=ig. Counting is attempted but not delivered from
your computer, because Desk only accepts the real website's address.

---

## 10. Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| aurioncreative.com/links shows a 404 | The website branch is not merged, or GitHub Pages has not finished | Check `links.html` is on `main`; wait two minutes |
| The page loads but Desk shows no views | Desk not deployed, or migration 0016 not applied | Desk README step 5; `npm run db:migrate` |
| Views from your own phone never appear | Your browser sends Do Not Track or GPC (Brave, some Firefox settings) | Expected. Test from another browser |
| Everything shows as "Direct" | The bio link has no `?via=` | Paste the exact link from section 1 |
| Instagram shows no referrer | Instagram's in-app browser hides it | Expected; that is why `?via=ig` exists |
| Visitors are lower than views | The same people opened it more than once that day | Expected |
| A renamed button lost its history | Its `data-link` value changed | Change it back; only `data-label` is for renaming |
| The icon is blurry or missing | Wrong size or path | 240 x 240 PNG at `assets/images/logos/aurion-icon.png` |
