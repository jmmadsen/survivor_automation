# CLAUDE.md

## Project Overview

This repo is a Python CLI for automating a March Madness survivor pool (100+ players, $25 buy-in). It fetches ESPN results, tracks picks via Google Sheets, generates color-coded formatted sheets, publishes to a public spreadsheet, and exports data for an interactive GitHub Pages dashboard.

## Key Files

- `src/config.py` — Constants (game days, sheet names, colors, ESPN API)
- `src/models.py` — Data classes (GameResult, PickStatus, PlayerRecord)
- `src/sheets_client.py` — Google Sheets API wrapper
- `src/espn_client.py` — ESPN API integration
- `src/results_updater.py` — Fetch/write game results & seeds
- `src/formatted_builder.py` — Build color-coded Formatted sheet
- `src/publisher.py` — Publish to public spreadsheet
- `src/roster_sync.py` — Sync participants from signup form
- `src/pick_validator.py` — Validate picks against results
- `src/site_exporter.py` — Export data as JSON for GitHub Pages dashboard
- `main.py` — CLI entry point with all subcommands
- `docs/` — GitHub Pages dashboard (index.html, styles.css, app.js, data/pool.json)

## Daily Workflow

Commands Temple runs each game day:

```bash
python main.py run-all --day <DATE>
python main.py publish
python main.py export-site
git add docs/data/pool.json && git commit -m "update dashboard data" && git push
```

## "Deploy Update" Shortcut

When the user says "deploy update" or "update the dashboard", run:

1. `python main.py export-site`
2. `git add docs/data/pool.json`
3. `git commit -m "update dashboard data for <current_day>"`
4. `git push origin main`
5. Confirm the GitHub Pages URL is live

## GitHub Pages Setup (One-Time)

Go to repo **Settings → Pages → Source: Deploy from branch → Branch: `main`, folder: `/docs`** → Save.

## Do Not Modify

The following files should only be changed if explicitly asked:

- `src/config.py`
- `src/models.py`
- `src/sheets_client.py`
- `src/espn_client.py`
- `src/results_updater.py`
- `src/formatted_builder.py`
- `src/publisher.py`
- `src/roster_sync.py`
- `src/pick_validator.py`
- `requirements.txt`

## Temple's GitHub Repo

`https://github.com/templecm4y/survivor_automation`
