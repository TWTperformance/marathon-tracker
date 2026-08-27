# Marathon Tracker

A personal, installable web app for tracking your Charlotte Marathon training —
daily runs, lifting sessions, Hooper Index wellness, Whoop recovery, and an
auto-computed weekly summary with the same warning flags as your original
Google Sheet.

It launches pre-seeded with everything you'd already logged in
"Inclusive Marathon Tracker.xlsx" (Weeks 1–8), and the full 19-week plan
from the Charlotte Marathon PDF is baked in as reference data — no more
opening the PDF or the spreadsheet on your phone.

## What it is

Plain HTML/CSS/JS, no build step, no framework, no server required for the
core app. It runs entirely in your browser and stores your data in
`localStorage` on your device.

It is **not** a Claude Artifact — Artifacts run in a sandbox that blocks all
outbound network calls except Google Fonts, which makes live Google Sheets
sync impossible there. This app needs to be hosted as a normal static
website so it can talk to the Google Sheets API directly from the browser.

## 1. Try it locally first

```bash
cd marathon-tracker-app
python -m http.server 8080
```

Open `http://localhost:8080` on your computer to click through it before
deploying. On your phone, it'll only be truly installable once it's served
over HTTPS from a real host (step 2).

## 2. Deploy to GitHub Pages (free, no CLI needed)

1. Go to [github.com/new](https://github.com/new) and create a new **public**
   repository (e.g. `marathon-tracker`).
2. On the repo page, click **Add file → Upload files**, and drag in every
   file from this `marathon-tracker-app` folder (`index.html`, `style.css`,
   `data.js`, `plan.js`, `app.js`, `sync.js`, `manifest.json`, `sw.js`,
   `icon-192.png`, `icon-512.png`). Commit.
3. Go to the repo's **Settings → Pages**. Under "Build and deployment",
   set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
   Save.
4. After a minute, GitHub shows your live URL:
   `https://<your-username>.github.io/marathon-tracker/`

Open that URL on your Android phone in Chrome, tap the **⋮** menu →
**Add to Home Screen**. It now behaves like an installed app.

Whenever you want to update the app (e.g. after I make changes), just
re-upload the changed files to the same repo — Pages redeploys
automatically in under a minute.

## 3. (Optional) Wire up live Google Sheets sync

This lets the app push what you log straight into your existing
"Inclusive Marathon Tracker" spreadsheet, and pull it back down. It's
genuinely optional — the app works fully offline on local storage without
this, and you can always use **Settings → Export Backup** to save a JSON
snapshot into your Drive folder manually.

### 3a. Convert your tracker to a native Google Sheet

The Sheets API can only write to native Google Sheets, not uploaded `.xlsx`
files. In Google Drive, open `Inclusive Marathon Tracker.xlsx`, then
**File → Save as Google Sheets**. Keep the tab names exactly as they are
(`Hooper Index`, `Whoop Recovery`, `Training Log`, `Weekly Summary`) —
the sync code matches on those names.

Grab the **Spreadsheet ID** from the resulting sheet's URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

### 3b. Create a Google Cloud OAuth Client ID

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   create a new project (top-left project picker → New Project). Any name
   is fine.
2. **APIs & Services → Library** → search "Google Sheets API" → Enable.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in app name (e.g. "Marathon Tracker"), your email as support/contact.
   - Save through the scopes and test users screens.
   - On the **Test users** step, add your own Google account email. This
     keeps the app in "Testing" mode, which is all you need for personal
     use — no Google verification review required. (Testing-mode tokens
     just mean you'll need to hit "Connect" again roughly every 7 days.)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add your GitHub Pages origin
     from step 2, exactly, with no trailing slash and no path:
     `https://<your-username>.github.io`
   - Create. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).
     You don't need the client secret — this app never uses one.

### 3c. Connect it in the app

Open the deployed app → **Settings** → paste the Client ID and Spreadsheet
ID → **Save Config** → **Connect** (this opens a Google sign-in popup,
allow the "See, edit, create, and delete your spreadsheets" permission —
that's the standard Sheets scope, and it only ever touches sheets you
open with it) → **Push to Sheet** or **Pull from Sheet**.

**Before your first real Push**, it's worth testing against a duplicate
copy of your sheet — this sync path hasn't been tested against your live
account (I can't run a Google OAuth flow from here), so I'd rather you
verify it once on a throwaway copy than find a surprise in your real
tracker.

### A note on the Duration column

Your original sheet has a few rows where "Duration (min)" got stored
ambiguously (e.g. one row as a clock-time instead of an elapsed duration —
I corrected that one when seeding this app). Going forward, this app
always stores and pushes duration as a **plain decimal number of minutes**
(e.g. `28.7`), matching what the column header already says. If the
Duration column's cell format in your Sheet is still set to a time/duration
format rather than plain Number, select that column and set
**Format → Number → Number** once, so new values display correctly instead
of as a garbled time.

## What's pre-loaded

- **Plan**: the full 19-week Charlotte Marathon schedule (running + lifting
  + autoregulation rules + milestones) from your PDF, tab-by-tab in the
  **Plan** view.
- **History**: your actual Training Log, Whoop Recovery, and Hooper Index
  entries through August 27, 2026, exactly as they were in your spreadsheet.

## Long run tracking

"Actual Long Run" for a week is the single **longest run you actually
logged that week**, whichever day it fell on — not tied to the Saturday
slot. So if you move your long run to a different day (travel, weather,
whatever), the app still attributes it correctly. This is different from
your original spreadsheet's `SUMIFS(...,"Saturday")` formula, which only
counted Saturday's entry — verified this fix against Week 7, where you'd
swapped the long run to Friday.

## Resetting

**Settings → Reset to Seed Data** wipes anything logged since first load
and restores this original historical export. Use **Export Backup** first
if you want to keep what you've added.
