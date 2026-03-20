# March Madness Survivor Pool Automation

A Python CLI that automates the March Madness survivor pool workflow:
- Fetches NCAA game results from ESPN and updates the **Teams & Results** sheet
- Reads the **Master** sheet and rebuilds the **Formatted** sheet with color-coded pick results
- Calculates each player's **Degen Score** (sum of seeds of correctly-picked teams) as a tiebreaker
- Publishes a separate **Public Picks** sheet (in a different workbook) for participants to view

---

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

Reads the Master sheet and calls the ESPN API to confirm everything is wired up correctly. Nothing is written.

---

## Start-of-Tournament Setup (run once)

These commands are run once at the beginning of each tournament, before any games are played.

### `populate-master` — Import participant roster from Signup Tracker

Reads the **Signup Tracker** sheet and appends any new participants (name + email) to the **Master** sheet. Safe to re-run — only adds names not already present, never overwrites existing rows.

```bash
python main.py populate-master
```

### `populate-seeds` — Fetch team seeds from ESPN

Pulls every first-round team's tournament seed (1–16) from ESPN and writes them to the **Team Seeds** sheet. This powers the Degen Score tiebreaker for the rest of the tournament.

Makes ~64 ESPN API calls — takes about 30 seconds. Safe to re-run if seeds need to be refreshed.

```bash
python main.py populate-seeds
```

> **Note:** The Team Seeds sheet and the Degen Score column in Master are created automatically if they don't exist yet.

---

## Commands

### `update-results` — Fetch ESPN results for a game day

Fetches results from ESPN and writes the losers into the **Teams & Results** sheet. Also auto-populates the Available Teams column for that day.

```bash
python main.py update-results --day 3/19
```

### `update-formatted` — Rebuild the internal Formatted sheet

Reads the Master sheet + Teams & Results and fully rebuilds the **Formatted** tab with color coding and Degen Scores. Completed game days are auto-detected from the Teams & Results sheet. Also writes each player's Degen Score back to the Master sheet.

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

Reveal picks only through a specific game day (later columns are blank for participants):

```bash
python main.py publish --day 3/19
```

### `run-all` — Update results + rebuild Formatted in one step

Runs `update-results` then `update-formatted` in sequence. Does **not** publish — that is always a separate manual step.

```bash
python main.py run-all --day 3/19
```

### `reset-public` — Wipe the public sheet clean

Deletes the Public Picks tab from the public spreadsheet so it can be rebuilt fresh on the next `publish`. Use this to recover from a bad publish or stale formatting.

```bash
python main.py reset-public
```

If the tab is the only sheet in the workbook (Google won't allow deleting the last tab), the content and formatting are cleared instead.

### `test-connection` — Verify setup without writing anything

Checks Google Sheets auth and ESPN API connectivity. Fetches the 2026 bracket from ESPN and prints the team list and derived mascot words.

```bash
python main.py test-connection
```

---

## Typical Daily Workflow

```bash
# Before tip-off — picks are in but no results yet
# All picks appear yellow (pending) so participants can see who picked what
python main.py run-all --day 3/19
python main.py publish --day 3/19

# After games finish — run again to apply results
python main.py run-all --day 3/19
python main.py publish --day 3/19
```

### If something looks wrong after publishing

```bash
python main.py reset-public          # wipe the public sheet
python main.py publish --day 3/19   # republish cleanly
```

---

## Sheet Structure

### Private spreadsheet

| Tab Name | Description |
|----------|-------------|
| `Master` | Source of truth for all player picks. Script reads picks from here and writes the Degen Score column. |
| `Picks` | Raw form responses and manual overrides. Resolved into Master by the organizer. |
| `Teams & Results` | Available teams + losers per game day. Script writes both columns from ESPN. |
| `Formatted` | Internal color-coded view with Degen Scores. Fully rebuilt by `update-formatted`. |
| `Team Seeds` | Tournament seed (1–16) for each team. Created by `populate-seeds`, read by `update-formatted`. |
| `Signup Tracker` | Form responses from the signup sheet. Read by `populate-master`. |

### Public spreadsheet (separate workbook)

| Tab Name | Description |
|----------|-------------|
| `Public Picks` | Participant-facing view. Same format as Formatted, including Degen Scores. Created and overwritten by `publish`. |

---

## Degen Score

The **Degen Score** is a tiebreaker that rewards risky picks. It equals the **sum of the seeds** of all teams a player correctly picked. Higher seeds (bigger underdogs) are worth more points — so a player who correctly picked a 12-seed contributes 12 points to their score.

- Only **correct picks** (green cells) count toward the score
- Wrong picks, missed picks, and future rounds do not count
- Eliminated players retain their score from their correct picks before elimination
- Both the Formatted and Public Picks sheets are **sorted by Degen Score descending** (highest score = best tiebreaker position)
- The score is also written to a **Degen Score column in the Master sheet** each time `update-formatted` runs — no manual setup needed

---

## Color Coding

Applies to both the Formatted (private) and Public Picks sheets.

| Color | Meaning |
|-------|---------|
| Light green row | Player is still alive |
| Green cell | Correct pick for a completed game day |
| Red cell | Picked a losing team |
| Yellow cell | Pick submitted but game not yet played, or no pick on a completed day |
| Gray row + strikethrough | Player has been eliminated |
| White cell | No pick submitted; future round not yet relevant |

Pick coloring is only applied to columns where final results have been loaded into the Teams & Results sheet. Picks after a player's elimination are hidden entirely.
