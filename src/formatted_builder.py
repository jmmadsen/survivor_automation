import logging
from typing import Optional

from src.config import (
    GAME_DAYS,
    SHEET_MASTER, SHEET_FORMATTED,
    MASTER_COL_NAME, MASTER_COL_EMAIL, MASTER_COL_PAID,
    MASTER_COL_ELIMINATED, MASTER_COL_ELIM_ON, MASTER_PICK_PREFIX,
    STATUS_ALIVE, STATUS_OUT,
    COLOR_WHITE, COLOR_RED, COLOR_YELLOW, COLOR_GRAY,
    COLOR_GREEN, COLOR_GREEN_ROW,
    COLOR_HEADER_BG, COLOR_HEADER_TEXT,
)
from src.models import PlayerRecord
from src.pick_validator import validate_picks_for_player, determine_elimination
from src.results_updater import read_all_available_and_losers
from src.sheets_client import SheetsClient, col_letter

logger = logging.getLogger(__name__)


def build_formatted_sheet(
    client: SheetsClient,
    game_days_with_results: list[str],
    display_days: list[str] | None = None,
    target_tab: str = SHEET_FORMATTED,
    create_if_missing: bool = False,
) -> list[PlayerRecord]:
    """
    Fully rebuilds the target sheet (default: Formatted) from Master + Teams & Results.

    Args:
        game_days_with_results: Days that have final results — used for pick validation and coloring.
        display_days: Columns to include in the output. Defaults to ALL GAME_DAYS so the full
                      bracket is always visible, not just completed rounds.
    Returns the sorted list of PlayerRecords.
    """
    if display_days is None:
        display_days = GAME_DAYS

    available_by_day, losers_by_day = read_all_available_and_losers(client)
    master_data = _read_master(client)
    players = _build_player_records(master_data, available_by_day, losers_by_day, game_days_with_results)
    players_sorted = _sort_players(players)

    header_row = _build_header_row(display_days)
    data_rows = [_build_player_row(p, display_days) for p in players_sorted]
    all_rows = [header_row] + data_rows

    client.clear_and_write(target_tab, all_rows, create_if_missing=create_if_missing)

    formats = _build_format_requests(players_sorted, display_days, game_days_with_results, losers_by_day)
    client.batch_format_cells(target_tab, formats)

    alive_count = sum(1 for p in players_sorted if p.still_alive)
    elim_count = len(players_sorted) - alive_count
    print(f"Built '{target_tab}': {len(players_sorted)} players ({alive_count} alive, {elim_count} eliminated)")
    return players_sorted


def _read_master(client: SheetsClient) -> list[dict]:
    """
    Read the Master sheet. Returns list of row dicts keyed by the header row.
    Multi-line headers (e.g. 'Valid?\\n3/19') are normalized to single-line.
    """
    all_values = client.read_all_values(SHEET_MASTER)
    if not all_values:
        return []

    # First row is the header; normalize multi-line headers
    raw_headers = all_values[0]
    headers = [h.replace("\n", " ").strip() for h in raw_headers]

    records = []
    for row in all_values[1:]:
        # Pad row to header length
        padded = row + [""] * (len(headers) - len(row))
        record = dict(zip(headers, padded))
        # Skip empty name rows
        if record.get(MASTER_COL_NAME, "").strip():
            records.append(record)

    logger.info(f"Read {len(records)} player rows from Master sheet")
    return records


def _build_player_records(
    master_data: list[dict],
    available_by_day: dict[str, list[str]],
    losers_by_day: dict[str, list[str]],
    game_days_with_results: list[str],
) -> list[PlayerRecord]:
    players = []
    for row in master_data:
        name = row.get(MASTER_COL_NAME, "").strip()
        if not name:
            continue

        email = row.get(MASTER_COL_EMAIL, "").strip()
        paid_val = row.get(MASTER_COL_PAID, "").strip().lower()
        paid = paid_val in ("yes", "y", "true", "1")

        # Read picks from Master sheet (source of truth)
        picks: dict[str, Optional[str]] = {}
        for day in GAME_DAYS:
            col_name = f"{MASTER_PICK_PREFIX}{day}"
            pick = row.get(col_name, "").strip() or None
            picks[day] = pick

        player = PlayerRecord(
            name=name,
            email=email,
            paid=paid,
            picks=picks,
        )

        # Validate picks against game results
        statuses = validate_picks_for_player(
            player, losers_by_day, available_by_day, game_days_with_results
        )
        player.pick_statuses = statuses

        # Determine elimination
        is_elim, elim_on = determine_elimination(statuses, game_days_with_results)

        # Also check Master sheet's own Eliminated? column as a fallback/override
        master_elim_status = row.get(MASTER_COL_ELIMINATED, "").strip()
        master_elim_on = row.get(MASTER_COL_ELIM_ON, "").strip()

        if is_elim:
            player.is_eliminated = True
            player.eliminated_on = elim_on
            player.still_alive = False
        elif master_elim_status == STATUS_OUT and master_elim_on in game_days_with_results:
            # Master says eliminated and that day's results have been loaded
            player.is_eliminated = True
            player.eliminated_on = master_elim_on
            player.still_alive = False
        else:
            player.is_eliminated = False
            player.eliminated_on = None
            player.still_alive = True

        players.append(player)

    return players


def _sort_players(players: list[PlayerRecord]) -> list[PlayerRecord]:
    """
    Sort order:
    1. Still alive → alphabetical by name
    2. Eliminated → most recently eliminated first, then alphabetical within same day
    """
    alive = sorted([p for p in players if p.still_alive], key=lambda p: p.name.lower())

    def elim_sort_key(p: PlayerRecord):
        if p.eliminated_on and p.eliminated_on in GAME_DAYS:
            day_rank = -GAME_DAYS.index(p.eliminated_on)  # negative → later days sort first
        else:
            day_rank = -999
        return (day_rank, p.name.lower())

    elim = sorted([p for p in players if not p.still_alive], key=elim_sort_key)
    return alive + elim


def _build_header_row(game_days: list[str]) -> list:
    return ["Name"] + game_days


def _build_player_row(player: PlayerRecord, game_days: list[str]) -> list:
    row = [player.name]
    elim_idx = _elimination_index(player)
    for day in game_days:
        day_idx = GAME_DAYS.index(day) if day in GAME_DAYS else 0
        pick = (player.picks.get(day) or "") if day_idx <= elim_idx else ""
        row.append(pick)
    return row


def _elimination_index(player: PlayerRecord) -> int:
    """Return the GAME_DAYS index of the player's elimination day, or len(GAME_DAYS) if not eliminated."""
    if player.is_eliminated and player.eliminated_on and player.eliminated_on in GAME_DAYS:
        return GAME_DAYS.index(player.eliminated_on)
    return len(GAME_DAYS)  # sentinel: never suppress picks


def _build_format_requests(
    players: list[PlayerRecord],
    display_days: list[str],
    game_days_with_results: list[str],
    losers_by_day: dict[str, list[str]] | None = None,
) -> list[dict]:
    """
    Build a list of batch_format request dicts covering all cells.
    Applied in order: reset → header → alive rows (green) → eliminated rows (gray) → per-cell pick colors.
    Per-cell colors only applied to columns where actual loser data exists in the sheet.
    Later entries override earlier ones for the same cell.
    """
    # A day counts as "having results" only if losers were actually written to the sheet.
    # This prevents all picks going green when --days-with-results is passed before update-results runs.
    if losers_by_day is not None:
        result_set = {d for d in game_days_with_results if losers_by_day.get(d)}
    else:
        result_set = set(game_days_with_results)
    formats = []
    total_cols = 1 + len(display_days)
    total_rows = 1 + len(players)

    # 1. Reset entire sheet to white, no strikethrough
    full_range = f"A1:{col_letter(total_cols)}{total_rows + 10}"  # +10 clears any stale rows below
    formats.append({
        "range": full_range,
        "format": {
            "backgroundColor": COLOR_WHITE,
            "textFormat": {
                "strikethrough": False,
                "bold": False,
                "foregroundColor": {"red": 0.0, "green": 0.0, "blue": 0.0},
            },
        },
    })

    # 2. Header row formatting (dark background, white bold text)
    header_range = f"A1:{col_letter(total_cols)}1"  # covers all display_days columns
    formats.append({
        "range": header_range,
        "format": {
            "backgroundColor": COLOR_HEADER_BG,
            "textFormat": {
                "bold": True,
                "foregroundColor": COLOR_HEADER_TEXT,
                "strikethrough": False,
            },
            "horizontalAlignment": "CENTER",
        },
    })

    for row_i, player in enumerate(players):
        sheet_row = row_i + 2  # 1-indexed; header is row 1

        # 3. Alive rows: subtle green background
        if player.still_alive:
            row_range = f"A{sheet_row}:{col_letter(total_cols)}{sheet_row}"
            formats.append({
                "range": row_range,
                "format": {
                    "backgroundColor": COLOR_GREEN_ROW,
                    "textFormat": {"strikethrough": False},
                },
            })

        # 4. Eliminated rows: gray + strikethrough
        else:
            row_range = f"A{sheet_row}:{col_letter(total_cols)}{sheet_row}"
            formats.append({
                "range": row_range,
                "format": {
                    "backgroundColor": COLOR_GRAY,
                    "textFormat": {
                        "strikethrough": True,
                        "foregroundColor": {"red": 0.4, "green": 0.4, "blue": 0.4},
                    },
                },
            })

        # 5. Per-cell coloring for pick result (overrides row color)
        elim_idx = _elimination_index(player)
        for col_i, day in enumerate(display_days):
            day_idx = GAME_DAYS.index(day) if day in GAME_DAYS else 0
            if day_idx > elim_idx:
                continue  # post-elimination: leave cell blank and white

            sheet_col = col_i + 2  # column A = Name, picks start at B
            cell_ref = f"{col_letter(sheet_col)}{sheet_row}"

            if day not in result_set:
                # Game hasn't been played yet — yellow if pick submitted, white if not
                if player.picks.get(day):
                    formats.append({
                        "range": cell_ref,
                        "format": {
                            "backgroundColor": COLOR_YELLOW,
                            "textFormat": {"strikethrough": False},
                        },
                    })
                continue

            # Day has results — color by outcome
            status = player.pick_statuses.get(day)
            if not status:
                continue

            if status.is_loser:
                # Red: picked a losing team
                formats.append({
                    "range": cell_ref,
                    "format": {
                        "backgroundColor": COLOR_RED,
                        "textFormat": {"strikethrough": False, "bold": True,
                                       "foregroundColor": {"red": 0.6, "green": 0.0, "blue": 0.0}},
                    },
                })
            elif status.picked_team is None:
                # Yellow: no pick submitted for a completed day
                formats.append({
                    "range": cell_ref,
                    "format": {
                        "backgroundColor": COLOR_YELLOW,
                        "textFormat": {"strikethrough": False},
                    },
                })
            elif status.picked_team:
                # Green: correct pick (team played and did not lose)
                formats.append({
                    "range": cell_ref,
                    "format": {
                        "backgroundColor": COLOR_GREEN,
                        "textFormat": {
                            "strikethrough": False,
                            "foregroundColor": {"red": 0.0, "green": 0.0, "blue": 0.0},
                        },
                    },
                })

    return formats
