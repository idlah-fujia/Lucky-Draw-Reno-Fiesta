# Sure-Win Spin

Phone signup and a big-screen prize wheel for IDLah’s Reno Fiesta and HomeFest events.

A homeowner scans a QR code, fills in the form on their own phone, and gets an 8-character code. They walk to the LED screen, type that code, the interior designer adds their details, and the wheel spins once. The prize is chosen by the server. Staff review entries at `/admin`.

This is a new site. It copies the look of the current Sure-Win page (navy, gold, orange, pink, the 32-slice wheel, the otters) and replaces the single-page demo with this two-step flow.

## The two pages

**Page 1, on the homeowner’s phone** (`/e/your-event` or `/?event=your-event`)

- Event (filled in by the QR code) and the date they attended
- Homeowner name, mobile, email, and the prize delivery address
- One photo or PDF of the receipt or signed contract (max 10 MB)
- The declarations and the same prize terms as the current spin page
- On submit: one row is saved, a code is shown, and the homeowner is emailed the code plus the link to the big screen

**Page 2, on the LED screen** (`/spin?event=your-event`)

- No file upload and nothing stored only in that browser
- Large keypad for the code. The server checks that the code exists, belongs to this screen’s event, has not been used, and is not voided. Only then does the screen move on to the designer’s details and the wheel. Staff do not have to approve the entry first
- One spin. The prize is picked on the server from the weights in `config/spin.config.json`
- The iPhone can be won once per event. The server checks that inside the same locked save as the spin, so two spins at once cannot both take it. After it has been won, that slice says FULLY REDEEMED and it cannot be awarded again
- Typing a code that already spun shows the prize again. It does not spin again
- About 25 seconds after the result (or the Next homeowner button), the screen returns to the keypad
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
- `kioskResetSeconds` (default 25), `invalidResetSeconds` (12), `idleResetSeconds` (90).

The numbers shipped in the file are **placeholders**, not approved odds. With those weights the iPhone is about **1 in 865** spins, and only once per event. Change the weights, run `npm run check`, and read the “1 in …” lines. The admin page shows the same table.

Do not reorder `slots` unless the wheel artwork is changed to match. Slot 1 is the top slice, then clockwise, 32 slices. The iPhone is slice 9 (index 8), which is the gold slice on the right.

## QR codes, one per event

Each event has its own link:

```text
https://YOUR-DOMAIN/e/reno-fiesta-nov-2026
https://YOUR-DOMAIN/e/homefest-2026
```

On the admin page, each event has a QR image and a **Download PNG** link. Print it at least 4 × 4 cm. High error correction is already set, so it still scans with a logo-sized quiet zone.

Any QR generator works too. Put that exact URL in, download a PNG, and print it. The big screen is a different URL (`/spin?event=same-slug`), not the QR. The QR is only for the phone form.

Opening `/` with no event shows a dropdown of open events. The QR is the normal way in.

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

If startup says the sheet is not shared, go back to step 6. If it says the header does not match, rename the old Entries tab and restart so the app can create a fresh one.

Proof files are not stored inside the sheet. The sheet has a `proof_link`. Anyone with that link can open the file, so only share the sheet with staff.

### Later, a database

Rows go through `src/storage/`. `local.js` is the CSV file. `sheets.js` is Google Sheets. Both speak the same language: load the rows, change them, save. A proper database table (for example Cloudflare D1 or Postgres) would be a third file with those same two operations. The pages would not need to change. Run **one** server while the store is a sheet or a CSV. Two servers writing at once can race; a database is the point at which that becomes safe.

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
- One screen per event, using that event’s `?event=` link. A code from another event is turned away.
- Leave the page open all day. Refresh it in the morning, not while someone is at the wheel. A refresh only clears what has not been saved; a finished spin is already on the server.
- **Fill the screen** in the corner does the same job if you are not using the kiosk shortcut.
- There is an on-screen keypad for the code and a keyboard for the designer’s name and email, so the PC does not need a keyboard. A real keyboard still works.
- If nobody touches the screen for 90 seconds during code entry, it clears itself. After a prize, it clears in 25 seconds, or sooner with **Next homeowner**.

## Codes

Eight characters. The alphabet skips O, 0, I, 1, and L so they are easy to read across the hall. The screen shows them as `ABCD EFGH`. Each homeowner mobile can register once per event. A voided entry can register again.

## Decided

- A code is checked on the server before the kiosk leaves the keypad. It must exist, belong to that screen’s event, be unused, and not be voided. Staff do not have to approve the proof before the spin.
- Prize delivery address is the final address the prize will be delivered to.
- One iPhone per event. After it has been given out, that slice says FULLY REDEEMED and the server will not award another, including when two spins are saved at the same time.

## Questions for the team

1. **Odds.** The weights are placeholders (iPhone about 1 in 865). What should the real odds be?
2. **QR.** One QR per event is the main path. The bare `/` page still has an event dropdown. Should that dropdown be removed?
3. **WhatsApp.** The code is emailed, not sent on WhatsApp. Should it also be sent on WhatsApp?
4. **Voids.** A voided mobile can submit again. Should it stay blocked?
5. **Declarations.** The terms text matches the current site. The three tick boxes are worded for the homeowner, because they fill in page 1. Please confirm that is what legal wants.
6. **From address.** Which domain should Resend send from?
