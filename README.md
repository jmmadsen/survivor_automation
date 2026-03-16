# March Madness Survivor Pool Automation

A Python CLI that automates the March Madness survivor pool workflow:
- Fetches NCAA game results from ESPN and updates the **Teams & Results** sheet
- Reads the **Master** sheet and rebuilds the **Formatted** sheet with color-coded pick results
- Publishes a separate **Public Picks** sheet (in a different workbook) for participants to view

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project.
2. Enable the **Google Sheets API** and **Google Drive API** for the project.
3. Go to **IAM & Admin → Service Accounts → Create Service Account**.
   - Give it a name like `survivor-pool-bot`
   - No special roles needed at the project level
4. After creation, click on the service account → **Keys → Add Key → JSON**.
5. Download the JSON file and place it at `credentials/service_account.json`.

### 3. Share Your Spreadsheets

Open the JSON file and copy the value of `client_email` (looks like `xxx@yyy.iam.gserviceaccount.com`).

Share **both** Google Sheets with that email address using **Editor** access:
- Your private master sheet (the one with Master, Picks, Teams & Results, etc.)
- Your public picks sheet (the one you share with participants)

### 4. Configure Environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

- `GOOGLE_CREDS_PATH`: path to your service account JSON (default: `credentials/service_account.json`)
- `SPREADSHEET_ID`: the ID from your private sheet's URL
  `https://docs.google.com/spreadsheets/d/**SPREADSHEET_ID**/edit`
- `PUBLIC_SPREADSHEET_ID`: the ID from your public sheet's URL

### 5. Verify Setup

```bash
python main.py test-connection
```

Reads the Master sheet and calls the ESPN API (using prior-year tournament data) to confirm everything is wired up correctly. Nothing is written.

---

## Commands

### `update-results` — Fetch ESPN results for a game day

Fetches results from ESPN and writes the losers into the **Teams & Results** sheet. Also auto-populates the Available Teams column for that day.

```bash
python main.py update-results --day 3/19
```

### `update-formatted` — Rebuild the internal Formatted sheet

Reads the Master sheet + Teams & Results and fully rebuilds the **Formatted** tab with color coding. Completed game days are auto-detected from the Teams & Results sheet.

```bash
python main.py update-formatted
```

Manually specify which days have final results (overrides auto-detection):

```bash
python main.py update-formatted --days-with-results 3/19 3/20
```

Preview what would be written without touching the sheet:

```bash
python main.py update-formatted --dry-run
```

### `publish` — Push picks to the public-facing spreadsheet

Builds the formatted picks data from the private sheet and writes it directly to the **Public Picks** tab in the separate public spreadsheet. This is a **deliberate, manual step** — run it when you're ready to reveal picks to participants (e.g., after the deadline or at first tipoff).

```bash
python main.py publish
```

Reveal picks only through a specific game day (later columns are hidden from participants):

```bash
python main.py publish --day 3/20
```

### `run-all` — Update results + rebuild Formatted in one step

Runs `update-results` then `update-formatted` in sequence. Does **not** publish — that is always a separate manual step.

```bash
python main.py run-all --day 3/20
```

### `reset-public` — Wipe the public sheet clean

Deletes the Public Picks tab from the public spreadsheet so it can be rebuilt fresh on the next `publish`. Use this to recover from a bad publish or stale formatting.

```bash
python main.py reset-public
```

If the tab is the only sheet in the workbook (Google won't allow deleting the last tab), the content and formatting are cleared instead.

### `test-connection` — Verify setup without writing anything

Checks Google Sheets auth and ESPN API connectivity. Fetches the real 2026 bracket from ESPN (3/19/2026) and prints the team list and derived mascot words.

```bash
python main.py test-connection
```

---

## Typical Daily Workflow

```bash
# 1. After games finish, pull results and rebuild the internal Formatted sheet
python main.py run-all --day 3/20

# 2. Open the Formatted tab in Google Sheets and verify it looks correct

# 3. When ready to reveal picks to participants, publish to the public sheet
python main.py publish --day 3/20
```

### If something looks wrong after publishing

```bash
python main.py reset-public          # wipe the public sheet
python main.py publish --day 3/20   # republish cleanly
```

---

## Sheet Structure

### Private spreadsheet

| Tab Name | Description |
|----------|-------------|
| `Master` | Source of truth for all player picks. **Read-only** — the script never writes here. |
| `Teams & Results` | Available teams + losers per game day. Script writes the Losers column and auto-populates Available Teams from ESPN. |
| `Formatted` | Internal color-coded view. Fully rebuilt by `update-formatted`. |

### Public spreadsheet (separate workbook)

| Tab Name | Description |
|----------|-------------|
| `Public Picks` | Participant-facing view. Same format as Formatted. Created and overwritten by `publish`. |

---

## Color Coding

Applies to both the Formatted (private) and Public Picks sheets.

| Color | Meaning |
|-------|---------|
| Light green row | Player is still alive |
| Green cell | Correct pick for a completed game day |
| Red cell | Picked a losing team |
| Yellow cell | No pick submitted for a completed game day |
| Gray row + strikethrough | Player has been eliminated |

Pick coloring is only applied to columns where final results have been loaded. Future rounds remain uncolored.
