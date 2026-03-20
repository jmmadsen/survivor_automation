import logging

import gspread

from src.config import (
    GAME_DAYS, GAME_DAY_TO_ESPN_DATE,
    SHEET_TEAMS_RESULTS, SHEET_SEEDS,
    TR_DATA_START, TR_COLS_PER_DAY,
)
from src.espn_client import fetch_games_for_day, fetch_teams_for_day, fetch_seeds_for_day, normalize_team_name
from src.sheets_client import SheetsClient, col_letter

logger = logging.getLogger(__name__)


def get_day_col_indices(game_day: str) -> tuple[int, int]:
    """
    Returns (available_col, losers_col) as 0-indexed column numbers
    for the given game day in the Teams & Results sheet.
    """
    day_index = GAME_DAYS.index(game_day)
    base = day_index * TR_COLS_PER_DAY
    return base, base + 1


def read_available_teams(client: SheetsClient, game_day: str) -> list[str]:
    """Read the Available Teams column for a game day from the Teams & Results sheet."""
    all_values = client.read_all_values(SHEET_TEAMS_RESULTS)
    avail_col, _ = get_day_col_indices(game_day)
    teams = []
    for row in all_values[TR_DATA_START:]:
        if avail_col < len(row) and row[avail_col].strip():
            teams.append(row[avail_col].strip())
    return teams


def read_losers(client: SheetsClient, game_day: str) -> list[str]:
    """Read existing losers for a game day from the Teams & Results sheet."""
    all_values = client.read_all_values(SHEET_TEAMS_RESULTS)
    _, losers_col = get_day_col_indices(game_day)
    losers = []
    for row in all_values[TR_DATA_START:]:
        if losers_col < len(row) and row[losers_col].strip():
            losers.append(row[losers_col].strip())
    return losers


def read_all_available_and_losers(client: SheetsClient) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """
    Read all available teams and losers for every game day in one API call.
    Returns (available_by_day, losers_by_day) dicts.
    """
    all_values = client.read_all_values(SHEET_TEAMS_RESULTS)
    available_by_day: dict[str, list[str]] = {}
    losers_by_day: dict[str, list[str]] = {}

    for game_day in GAME_DAYS:
        avail_col, losers_col = get_day_col_indices(game_day)
        available = []
        losers = []
        for row in all_values[TR_DATA_START:]:
            if avail_col < len(row) and row[avail_col].strip():
                available.append(row[avail_col].strip())
            if losers_col < len(row) and row[losers_col].strip():
                losers.append(row[losers_col].strip())
        available_by_day[game_day] = available
        losers_by_day[game_day] = losers

    return available_by_day, losers_by_day


def detect_days_with_results(client: SheetsClient) -> list[str]:
    """Return game days that have at least one non-empty loser entry."""
    _, losers_by_day = read_all_available_and_losers(client)
    return [day for day in GAME_DAYS if losers_by_day.get(day)]


def populate_available_teams(client: SheetsClient, game_day: str) -> list[str]:
    """
    Fetch teams playing on game_day from ESPN and write them to the Available Teams column.
    Always overwrites — ESPN is the source of truth for which teams are playing.
    Returns the sorted list of school names written.
    """
    if game_day not in GAME_DAYS:
        raise ValueError(f"Unknown game day '{game_day}'. Valid: {GAME_DAYS}")

    espn_date = GAME_DAY_TO_ESPN_DATE[game_day]
    logger.info(f"Fetching available teams for {game_day} ({espn_date}) from ESPN...")
    teams = fetch_teams_for_day(game_day, espn_date)

    if not teams:
        logger.warning(f"No teams found from ESPN for {game_day} — tournament may not be scheduled yet")
        return []

    _write_available_teams(client, game_day, teams)
    print(f"Populated {len(teams)} available teams for {game_day} in Teams & Results sheet.")
    return teams


def update_results_for_day(client: SheetsClient, game_day: str) -> list[str]:
    """
    Populate available teams from ESPN, then fetch results and write losers.
    Returns the list of loser names written.
    Safe to call before games start (populates teams, skips losers if nothing is final yet).
    """
    if game_day not in GAME_DAYS:
        raise ValueError(f"Unknown game day '{game_day}'. Valid: {GAME_DAYS}")

    # Always refresh Available Teams from ESPN first
    available_teams = populate_available_teams(client, game_day)
    if not available_teams:
        return []

    espn_date = GAME_DAY_TO_ESPN_DATE[game_day]
    logger.info(f"Fetching ESPN results for {game_day} ({espn_date})...")
    game_results = fetch_games_for_day(game_day, espn_date)

    if not game_results:
        logger.warning(f"No games returned from ESPN for {game_day}")
        return []

    unfinished = [g for g in game_results if not g.is_final]
    if unfinished:
        logger.warning(
            f"{len(unfinished)} game(s) not yet final for {game_day}: "
            + ", ".join(f"{g.winner or '?'} vs {g.loser or '?'}" for g in unfinished)
        )

    final_results = [g for g in game_results if g.is_final]
    if not final_results:
        print(f"No final results yet for {game_day} — available teams populated, check back after games finish.")
        return []

    # Since both available_teams and results now use team["location"] from ESPN,
    # names should match exactly. normalize_team_name is kept as a safety net.
    losers: list[str] = []
    for result in final_results:
        if result.loser in available_teams:
            losers.append(result.loser)
            logger.info(f"  LOSS: {result.loser} ({result.winner} {result.winner_score}-{result.loser_score})")
        else:
            # Fallback fuzzy match in case of any inconsistency
            try:
                normalized = normalize_team_name(result.loser, available_teams)
                losers.append(normalized)
                logger.info(f"  LOSS (fuzzy): {result.loser} → '{normalized}'")
            except ValueError as e:
                logger.warning(str(e))
                losers.append(result.loser)

    _write_losers(client, game_day, losers)
    print(f"Wrote {len(losers)} loser(s) for {game_day} to Teams & Results sheet.")
    return losers


def populate_seeds(client: SheetsClient) -> None:
    """
    Fetch tournament seeds for all 64 first-round teams from ESPN and write them
    to the 'Team Seeds' sheet. Safe to re-run — overwrites existing data.

    Run once at the start of the tournament via: python main.py populate-seeds
    Seeds are stable for the whole tournament, so this is not called automatically
    by update-results.
    """
    # Seeds come directly from scoreboard curatedRank.current — 2 API calls total.
    # 3/19 + 3/20 together cover all 64 first-round teams.
    print("Fetching seeds from ESPN scoreboard (2 API calls)...")
    seeds: dict[str, int] = {}
    for game_day in GAME_DAYS[:2]:
        espn_date = GAME_DAY_TO_ESPN_DATE[game_day]
        try:
            day_seeds = fetch_seeds_for_day(game_day, espn_date)
            seeds.update(day_seeds)
        except RuntimeError as e:
            logger.warning(str(e))

    if not seeds:
        print("Could not retrieve any seed data from ESPN — bracket may not be posted yet.")
        return

    rows = [["Team", "Seed"]] + [[team, seed] for team, seed in sorted(seeds.items())]
    client.clear_and_write(SHEET_SEEDS, rows, create_if_missing=True)

    print(f"Written {len(seeds)} team seeds to '{SHEET_SEEDS}' sheet.")
    for team, seed in sorted(seeds.items(), key=lambda x: (x[1], x[0])):
        logger.debug(f"  {seed:>2}  {team}")


def read_seeds(client: SheetsClient) -> dict[str, int]:
    """
    Read the Team Seeds sheet and return {team_name: seed_int}.
    Returns an empty dict if the sheet does not exist or has no data.
    """
    try:
        rows = client.read_all_values(SHEET_SEEDS)
    except gspread.WorksheetNotFound:
        logger.warning(f"'{SHEET_SEEDS}' sheet not found — Degen Scores will be 0. Run 'populate-seeds' first.")
        return {}

    if len(rows) < 2:
        return {}

    seeds: dict[str, int] = {}
    for row in rows[1:]:  # skip header
        if len(row) >= 2 and row[0].strip():
            try:
                seeds[row[0].strip()] = int(float(row[1]))
            except (ValueError, TypeError):
                logger.warning(f"Could not parse seed for team '{row[0]}': '{row[1]}'")
    logger.info(f"Read seeds for {len(seeds)} teams from '{SHEET_SEEDS}'")
    return seeds


def _write_column(client: SheetsClient, game_day: str, col_0idx: int, values: list[str], clear_rows: int = 32) -> None:
    """Write a list of values to a specific column for a game day. Clears stale rows first."""
    col_1idx = col_0idx + 1
    col = col_letter(col_1idx)
    start_row = TR_DATA_START + 1  # 1-indexed

    rows_to_clear = max(len(values) + 5, clear_rows)
    clear_range = f"{col}{start_row}:{col}{start_row + rows_to_clear - 1}"
    client.update_range(SHEET_TEAMS_RESULTS, clear_range, [[""] for _ in range(rows_to_clear)])

    if values:
        write_range = f"{col}{start_row}:{col}{start_row + len(values) - 1}"
        client.update_range(SHEET_TEAMS_RESULTS, write_range, [[v] for v in values])


def _write_available_teams(client: SheetsClient, game_day: str, teams: list[str]) -> None:
    """Write the Available Teams column for game_day."""
    avail_col, _ = get_day_col_indices(game_day)
    _write_column(client, game_day, avail_col, teams)


def _write_losers(client: SheetsClient, game_day: str, losers: list[str]) -> None:
    """Write the Losers column for game_day."""
    _, losers_col = get_day_col_indices(game_day)
    _write_column(client, game_day, losers_col, losers)
