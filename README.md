# Sure-Win Spin

Phone signup and a big-screen prize wheel for IDLah’s Reno Fiesta and HomeFest events.

Someone fills the phone form for a homeowner: homeowner details, then the interior designer’s details, in one submission. The homeowner gets an 8-character code by email. At the LED screen they type that code and the wheel unlocks straight away. The prize is chosen by the server. Staff review entries at `/admin`.

This is a new site. It copies the look of the current Sure-Win page (navy, gold, orange, pink, the 32-slice wheel, the otters) and replaces the single-page demo with this two-step flow.

## Two services, one repo

`SITE_MODE` decides what `/` does. Leave it unset and it is `after_event`.

| `SITE_MODE` | `/` opens | Spin page |
| --- | --- | --- |
| `event_day` | `/spin?event=<first open event>` | Logo, centred registration QR, code field, then the wheel |
| `after_event` | `/e/<first open event>` | Same centred layout. After signup, **Spin now** opens `/spin?event=<slug>&code=<code>` and the phone skips the QR and the code box |

Set `PUBLIC_BASE_URL` to that service’s own `https` address so the QR and emails use its host. An event can set `"mode": "event_day"` or `"mode": "after_event"` to override the service for that event only. The QR size control still changes the code. The position control is not used: the QR stays centred.

One service serves both versions. `/events` is the on-site big screen and its phone form. `/virtual` is the after-event phone form. `/` opens `/events`. `/admin` is the combined admin page. Links and QR codes use `PUBLIC_BASE_URL` plus `/events` or `/virtual`. Staff sign in at `/admin`. The Event QR codes section chooses the live event for both home pages. New events are stored in the sheet tab `Events`, and the live choice in `Settings`. The first admin is created on startup from `ADMIN_EMAIL` (default `admin@renofiesta.sg`) and `ADMIN_PASSWORD` when no admin is stored yet. Admins manage accounts in **Staff accounts**. Staff can view entries and mark them verified. Export, void, proof files, LED settings, and account changes stay with admins, and the server refuses those calls. Accounts live in the `users` tab when Google Sheets is connected, otherwise `data/users.json`. On Render’s free disk that file is wiped on restart, so only the bootstrap admin comes back until Sheets is connected. `verified_by` and `voided_by` record who reviewed an entry.

## The two pages

**Page 1, on a phone** (`/e/your-event`, `/`, or `/register`)

- Event dropdown from `config/spin.config.json`. `/e/your-event` and `/?event=your-event` preselect that event, and it can still be changed. `/` and `/register` start with no event chosen.
- Event date comes from that event. A one-day event is filled in and locked. A multi-day event is a dropdown of those days. There is no free-typed date.
- Step 1, homeowner details: name, mobile, email, one photo or PDF of the receipt or signed contract (max 10 MB), and the declarations. **Next** checks this step in the browser and does not call the server. The chosen file stays selected. The form does not ask for a prize delivery address. The sheet column `delivery_address` stays so older rows are unchanged; new rows leave it blank.
- Step 2, designer details: name, mobile, email, and interior design company. **Back** returns to step 1 without clearing it. **Submit & get my spin code** sends homeowner, designer, and proof in one request.
- On submit: one row is saved, including the designer. A code is shown. Only the homeowner is emailed the code. The designer is emailed later, with the homeowner, after the spin.

**Page 2, on the LED screen** (`/spin?event=your-event`)

- A large registration QR at the top (staff can move and resize it). It encodes this event’s phone form, for example `https://YOUR-DOMAIN/e/reno-fiesta-nov-2026`. The address comes from `PUBLIC_BASE_URL`, then `RENDER_EXTERNAL_URL`, then the request host. It is not hardcoded. With no `?event=`, the first open event is used.

- No file upload and nothing stored only in that browser
- Large keypad for the code. The server checks that the code exists, belongs to this screen’s event, has designer details saved, has not been used, and is not voided. The wheel then unlocks. There is no designer form on this screen. A code saved without a designer is turned away. Staff do not have to approve the entry first
- One spin. The prize is picked on the server from the weights in `config/spin.config.json`
- The iPhone can be won once per event. The server checks that inside the same locked save as the spin, so two spins at once cannot both take it. After it has been won, that slice says FULLY REDEEMED and it cannot be awarded again
- Typing a code that already spun shows the prize again. It does not spin again
- Two minutes after the result (or the Close button), the screen returns to the keypad. The pop-up counts down as “Closing in 2:00”, then “Closing in 1:59”. Change `kioskResetSeconds` to use a different length.
- The page asks the display to stay awake and pings the server every 45 seconds so a long event day does not drop the connection

## Run it on a computer

You need Node.js 20 or newer. Check with `node -v`.

```bash
cd sure-win-spin
cp .env.example .env
```

Open `.env` and set `ADMIN_PASSWORD` to a password you will remember (at least 8 characters). Leave the Google and email lines blank for a first test.

```bash
npm install
npm start
```

Then open:

- Phone form for Reno Fiesta: http://127.0.0.1:47231/e/reno-fiesta-nov-2026
- Big screen: http://127.0.0.1:47231/spin?event=reno-fiesta-nov-2026
- Staff page: http://127.0.0.1:47231/admin

Until Google Sheets is connected, entries are saved in **`data/entries.csv`**. Open that file in Excel or Google Sheets. Proof files are in `data/uploads`. Emails are not sent; they are listed under Email outbox on the admin page, and the code screen tells the homeowner to screenshot the code.

`npm test` checks the signup, the single spin, the one-iPhone rule, and the admin export. `npm run check` checks `config/spin.config.json` and prints the current odds.

## Staff page

Sign in with `ADMIN_PASSWORD`.

You can search, filter, open the proof file, download a CSV, mark an entry **verified** or **voided**, and undo a void. A voided code cannot spin. If the voided prize was the iPhone, that iPhone can be won again.

Statuses:

| Status | Meaning |
| --- | --- |
| submitted | Phone form is in. They have not spun, or the designer has saved their details and the spin is still waiting. |
| spun | The wheel has been spun. Staff have not verified the paperwork. |
| verified | Staff checked the entry. If they had not spun yet, they still can. |
| voided | The code is blocked. |

The spin does **not** wait for verification. See “Questions for the team” if that should change.

## Prize odds and events

Edit **`config/spin.config.json`**, then save. The server picks up a valid file on the next spin. If the file is broken, it keeps the last good copy and the terminal shows the error. Run `npm run check` after editing.

Safe edits:

- `weight` on each prize. Higher means more likely. `0` takes it off the wheel.
- `events`: add a row per festival or per day. `slug` is the short name in the URL (`reno-fiesta-nov-2026`). Use lowercase letters, numbers, and hyphens. `active: false` closes the phone form.
- `kioskResetSeconds` (default 120, the result pop-up), `invalidResetSeconds` (12), `idleResetSeconds` (90, code entry only; it does not close the result pop-up).

The numbers shipped in the file are **placeholders**, not approved odds. With those weights the iPhone is about **1 in 865** spins, and only once per event. Change the weights, run `npm run check`, and read the “1 in …” lines. The admin page shows the same table.

Do not reorder `slots` unless the wheel artwork is changed to match. Slot 1 is the top slice, then clockwise, 32 slices. The iPhone is slice 9 (index 8), which is the gold slice on the right.

## QR codes, one per event

Each event has its own link:

```text
https://YOUR-DOMAIN/e/reno-fiesta-nov-2026
https://YOUR-DOMAIN/e/homefest-2026
```

On the admin page, each event has a QR image and a **Download PNG** link. Print it at least 4 × 4 cm. High error correction is already set, so it still scans with a logo-sized quiet zone.

Any QR generator works too. Put that exact URL in, download a PNG, and print it. The big screen is a different URL (`/spin?event=same-slug`). That page also shows the same phone-form QR, large enough to scan from the LED.

Opening `/` or `/register` with no event shows the event dropdown and does not preselect one. `/e/your-event` preselects that event.

### LED screen QR size and position

On `/admin`, **LED screen QR** sets the size and the position for the big screen. Size is 16–70% of the screen width, or 160–900 px. Position is top left, top centre, top right, bottom left, bottom centre, or bottom right. The preview updates as you move the controls. **Save** writes the choice. The screen asks for the current setting every 20 seconds, and also when it resets for the next person. No rebuild.

Settings are per event, or “All events (default)” when an event has no row of its own. An event row wins over the default row.

Where they are stored:

- **Google Sheet connected:** a tab named **KioskQr** (`event_slug`, `size`, `unit`, `position`, `updated_at`). The app creates the tab. This survives a Render restart.
- **No sheet:** `data/kiosk-qr.json` next to the entries file. Render’s free disk is wiped on restart, so this file does not survive a deploy or a spin-down.

Env defaults, used when nothing is saved (and after a wiped disk):

| Variable | Example | Meaning |
| --- | --- | --- |
| `KIOSK_QR_SIZE` | `16%` or `280px` | Percent of screen width (16–70) or pixels (160–900). A bare number is a percent. The built-in default is 16%, about a 280px code on a 1920 screen. |
| `KIOSK_QR_POSITION` | `top-center` | `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`. `centre` is accepted. |

Set both on the Render service if you want a restart to keep a size when Sheets is not connected. A saved admin value overrides these until that store is wiped. The admin routes require the admin password.

## Email

Signup emails the homeowner the code and the big-screen link. After the spin, the homeowner and the designer both get the prize and a short summary (names, numbers, company, address, code). A failed email never blocks the signup or the spin.

To actually send mail, use [Resend](https://resend.com):

1. Create an account and add the domain the mail should come from. Resend shows DNS records; whoever manages the domain adds them.
2. Create an API key.
3. In `.env` set `RESEND_API_KEY` and `EMAIL_FROM`, for example `IDLah Sure-Win <spin@idlah.sg>`.
4. Restart the server. Submit a test entry and check the inbox. The admin outbox shows `sent` or the error.

Leave `RESEND_API_KEY` blank and nothing is sent. The code is still on screen, in the CSV or Sheet, and in the outbox.

## Google Sheets

This is the store the team can open like Excel. One row per entry. The column names match the CSV export:

`id`, `code`, `status`, `event_slug`, `event_name`, `event_edition`, `event_date`, `homeowner_name`, `homeowner_phone`, `homeowner_email`, `delivery_address`, `designer_name`, `designer_phone`, `designer_email`, `id_company`, `proof_key`, `proof_link`, `proof_filename`, `proof_mime`, `proof_bytes`, `prize_id`, `prize_label`, `prize_brand`, `prize_slot`, `decl_contract`, `decl_genuine`, `decl_verify`, `decl_tnc`, `code_email_status`, `result_email_status`, `created_at`, `designer_saved_at`, `spun_at`, `verified_at`, `voided_at`, `updated_at`

The app creates a tab named **Entries** and writes the header itself. Use a new empty spreadsheet.

### What you need

A Google Cloud service account, and the sheet shared with that account as **Editor**. There is no personal Gmail password in `.env`.

1. Open https://console.cloud.google.com/ and create a project, for example `IDLah Spin`.
2. APIs & Services → Library → search **Google Sheets API** → Enable.
3. APIs & Services → Credentials → Create credentials → Service account. Name it `spin-sheet`.
4. Open that service account → Keys → Add key → JSON. A file downloads. Treat it like a password. Do not email it or commit it.
5. Create a Google Sheet named `Sure-Win Spin entries`.
6. Share the sheet with the service account email (it ends in `iam.gserviceaccount.com`) as **Editor**.
7. The sheet URL looks like `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`. Copy `SPREADSHEET_ID`.
8. On the server:

```bash
node scripts/env-from-google-json.js ~/Downloads/the-key-file.json SPREADSHEET_ID
```

9. Paste the three lines it prints into `.env`. Restart (`Ctrl+C`, then `npm start`).
10. Submit one test entry. The Entries tab should gain a row. The admin banner should say the Google Sheet is connected.

If startup says the sheet is not shared, go back to step 6. A header that is just missing newer columns at the end is extended in place, and a blank header is retried so two services can open the sheet together. If the header is a different set of names and the tab already has entries, rename that tab and restart.

Proof files are not stored inside the sheet. The sheet has a `proof_link`. Anyone with that link can open the file, so only share the sheet with staff.

### Later, a database

Rows go through `src/storage/`. `local.js` is the CSV file. `sheets.js` is Google Sheets. Both speak the same language: load the rows, change them, save. A proper database table (for example Cloudflare D1 or Postgres) would be a third file with those same two operations. The pages would not need to change. The on-site and after-event services share one sheet. Each re-reads it before issuing a code or awarding the iPhone, and keeps its own in-process lock as well. A database is still the stronger lock if the two services ever write the same row at the same moment.

## Proof files

Default: `data/uploads` on the server. On a hosted server, use a disk that survives restarts and set `DATA_DIR` to that folder (see Deploy).

Optional Cloudflare R2 (private bucket, files still open only through the link):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

Create the keys under Cloudflare → R2 → Manage API tokens. Restart after setting them. The admin banner shows whether files are local or on R2.

## Deploy on Render (free trial)

`render.yaml` is a Blueprint for a free web service. Render’s free disk is wiped on restart, which is fine for a trial: entries stay in `data/entries.csv` and proof files in `data/uploads` until you connect Google Sheets or R2. Connect Sheets before a real event so a restart does not erase the list.

The process listens on `process.env.PORT` (Render sets this) and `0.0.0.0`. Health check path: `/api/health`.

**Docker (what the Blueprint uses)**

- Runtime: Docker
- Dockerfile path: `./Dockerfile`
- Build: Render builds the image. The image runs `npm ci --omit=dev`, then `node src/server.js`
- Start command: `node src/server.js` (already the image `CMD`; leave Render’s start command empty)
- Plan: Free
- Branch: `main`
- Health check path: `/api/health`

**Node, if the free plan will not build Docker**

- Runtime: Node
- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- Health check path: `/api/health`

Environment variables the Blueprint sets:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `TRUST_PROXY` | `1` |
| `ALLOW_FORCE_PRIZE` | `0` |
| `ADMIN_PASSWORD` | generated by Render. Copy it from the service’s Environment page. It is the `/admin` password. |
| `FILE_LINK_SECRET` | generated by Render. Signs the proof-file links. |

`PORT` is set by Render. Do not set it yourself.

Leave `PUBLIC_BASE_URL` blank on the first deploy. The app uses Render’s `RENDER_EXTERNAL_URL` for QR codes and email links. After you add a custom domain, set `PUBLIC_BASE_URL` to `https://that-domain` with no slash at the end.

Optional, so the LED QR keeps its size after a free-plan restart when Google Sheets is not connected: `KIOSK_QR_SIZE` and `KIOSK_QR_POSITION`. See “LED screen QR size and position”.

Optional, add in the Render dashboard when you have them. Leave them empty for the trial:

- `RESEND_API_KEY`, `EMAIL_FROM`
- `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

The free service sleeps after inactivity. The first visit after that can take a minute.

A paid disk is only needed when you want proof files to survive a restart and you are not using R2. Mount it at `/app/data` and set `DATA_DIR=/app/data`.

## Deploy anywhere else

A small Node server is enough. The `Dockerfile` is the same one Render uses.

1. Push `main` to the Git host Render (or Railway, Fly, a VPS) can see.
2. New Web Service → Docker, or Node with build `npm ci --omit=dev` and start `npm start`.
3. Set `ADMIN_PASSWORD`, `TRUST_PROXY=1`, and `ALLOW_FORCE_PRIZE=0`. Set `PUBLIC_BASE_URL` if the host does not provide `RENDER_EXTERNAL_URL`.
4. Health check path: `/api/health`.
5. Open `https://YOUR-DOMAIN/admin`, sign in, and download a QR.

On a VPS without Docker:

```bash
npm install
npm start
```

Put HTTPS in front (Caddy or nginx). Keep the process running with `systemd` or `pm2`. Open port `47231` only to the proxy, not to the whole internet, if the proxy is on the same machine.

## The LED screen

Use Chrome. The address is the spin page, with the event filled in:

```text
https://YOUR-DOMAIN/spin?event=reno-fiesta-nov-2026
```

Everything loads from that site. Do not copy files onto the screen PC.

**Windows.** Make a shortcut. Target:

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --no-first-run --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --disable-translate --overscroll-history-navigation=0 "https://YOUR-DOMAIN/spin?event=reno-fiesta-nov-2026"
```

**Mac.** Terminal:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --kiosk --autoplay-policy=no-user-gesture-required "https://YOUR-DOMAIN/spin?event=reno-fiesta-nov-2026"
```

Leave kiosk with Alt+F4 (Windows) or Cmd+Q (Mac).

Also:

- Power settings: screen never sleeps while plugged in. The page also asks the browser to stay awake, and pings the server every 45 seconds.
- Sound on. The wheel ticks and plays a short fanfare. The first tap of the day starts audio; the Chrome flag above allows it without that tap. Tap **Sound on** in the corner if the hall is too loud.
- One screen per event, using that event’s `?event=` link. A code from another event is turned away. If the link has no event, the first open event is used and the address bar is updated.
- The registration QR sits at the top (unless staff moved it). Scrolling the page reaches the keypad and the wheel. After a reset the page returns to the QR.
- Leave the page open all day. Refresh it in the morning, not while someone is at the wheel. A refresh only clears what has not been saved; a finished spin is already on the server.
- **Fill the screen** in the corner does the same job if you are not using the kiosk shortcut.
- Type the code with a normal keyboard or paste it. The box turns everything into capitals and skips O, 0, I, 1 and L. Designer details are entered on the phone, not on this screen.
- If nobody touches the screen for 90 seconds during code entry, it clears itself. That idle timer does not run while the prize pop-up is open. After a prize, the pop-up closes in 2 minutes (`kioskResetSeconds`), or sooner with **Close**. The countdown reads “Closing in 2:00”.

## Codes

Eight characters. The alphabet skips O, 0, I, 1, and L so they are easy to read across the hall. The screen shows them as `ABCD EFGH`. Each homeowner mobile can register once per event. A voided entry can register again.

## Decided

- A code is checked on the server before the kiosk leaves the keypad. It must exist, belong to that screen’s event, be unused, and not be voided. Staff do not have to approve the proof before the spin.
- The phone form does not collect a prize delivery address. The sheet column stays for older rows.
- One iPhone per event. After it has been given out, that slice says FULLY REDEEMED and the server will not award another, including when two spins are saved at the same time.

## Questions for the team

1. **Odds.** The weights are placeholders (iPhone about 1 in 865). What should the real odds be?
2. **QR.** One printed QR per event is still the main path. `/` and `/register` keep an event dropdown with nothing preselected, for people filling the form after the event.
3. **WhatsApp.** The code is emailed, not sent on WhatsApp. Should it also be sent on WhatsApp?
4. **Voids.** A voided mobile can submit again. Should it stay blocked?
5. **Declarations.** The terms text matches the current site. The three tick boxes are worded for the homeowner, because they fill in page 1. Please confirm that is what legal wants.
6. **From address.** Which domain should Resend send from?
