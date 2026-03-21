"""
Export survivor pool data as JSON for the GitHub Pages dashboard.

Reads the same Google Sheets data the existing workflow uses, repackages
it as a single JSON file, and writes to disk.  Does NOT modify any
existing sheet or module.

Output schema matches what docs/app.js expects:
  - meta: pool info (total players, alive, pot, etc.)
  - team_seeds: {team: seed}
  - daily_results: array of per-day objects with stats
  - players: array with status string, rank int, picks array
  - survival_curve: array of {day, alive, label}
  - predictions: pick_overlap and remaining_teams_by_player
"""

import json
import logging
import os
from collections import Counter
from datetime import datetime, timezone

from src.config import (
    GAME_DAYS, GAME_DAY_TO_ESPN_DATE,
    GAME_DAY_LABELS, GAME_DAY_ISO_DATES,
    POOL_NAME, POOL_SEASON, POOL_ENTRY_FEE,
)
from src.espn_client import fetch_games_for_day
from src.formatted_builder import (
    _read_master,
    _build_player_records,
    _sort_players,
)
from src.models import PlayerRecord
from src.results_updater import (
    read_all_available_and_losers,
    read_seeds,
)
from src.sheets_client import SheetsClient

logger = logging.getLogger(__name__)

# Fallback sentinel used when a stat cannot be computed (prevents JS null-deref)
_BLANK_STAT = "—"

# Picks that aren't real team selections (case-insensitive)
_INVALID_PICK_NAMES = {"no pick", "no picks", ""}


def _is_valid_pick(team: str | None) -> bool:
    """Return True if the pick is a real team name (not blank or 'No Pick')."""
    return bool(team) and team.strip().lower() not in _INVALID_PICK_NAMES


def _is_pick_after_elimination(player: PlayerRecord, game_day: str) -> bool:
    """Return True if this pick is for a day after the player was eliminated."""
    if player.still_alive or not player.eliminated_on:
        return False
    if player.eliminated_on not in GAME_DAYS:
        return False
    elim_idx = GAME_DAYS.index(player.eliminated_on)
    day_idx = GAME_DAYS.index(game_day)
    return day_idx > elim_idx


def export_site_data(
    client: SheetsClient,
    output_path: str = "docs/data/pool.json",
) -> None:
    """
    Build and write the JSON snapshot consumed by the GitHub Pages frontend.

    Reads Master, Teams & Results, and Team Seeds sheets via existing helpers,
    computes stats / upsets / predictions, and writes a single JSON file.
    """

    # ---- 1. Gather data from sheets ----------------------------------------
    available_by_day, losers_by_day = read_all_available_and_losers(client)
    seeds_by_team = read_seeds(client)
    master_data = _read_master(client)
    days_with_results = [day for day in GAME_DAYS if losers_by_day.get(day)]

    # Detect pending days: days ≤ today with picks submitted but no results yet
    pending_days = _detect_pending_days(master_data, days_with_results)

    # All days to show on the dashboard (completed + pending)
    all_display_days = days_with_results + pending_days

    # Build and sort player records (seeds_by_team drives degen scores)
    players = _build_player_records(
        master_data, available_by_day, losers_by_day,
        days_with_results, seeds_by_team,
    )
    players_sorted = _sort_players(players)

    # ---- 2. Build per-day daily_results array ------------------------------
    daily_results = _build_daily_results(
        days_with_results, seeds_by_team,
        available_by_day, losers_by_day, players_sorted,
        pending_days=pending_days,
    )

    # ---- 3. Build players array (new schema) --------------------------------
    players_json = _build_players_json(players_sorted, days_with_results, seeds_by_team)

    # ---- 4. Compute predictions & risk data --------------------------------
    predictions = _compute_predictions(players_sorted, seeds_by_team, days_with_results, losers_by_day)

    # ---- 5. Assemble and write JSON ----------------------------------------
    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "meta": _build_meta(players_sorted, all_display_days),
        "team_seeds": seeds_by_team,
        "daily_results": daily_results,
        "players": players_json,
        "survival_curve": _build_survival_curve(players_sorted, days_with_results),
        "predictions": predictions,
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)

    alive_count = sum(1 for p in players_sorted if p.still_alive)
    pending_info = f", {len(pending_days)} pending" if pending_days else ""
    print(f"Exported site data to {output_path} "
          f"({len(players_sorted)} players, {alive_count} alive, "
          f"{len(days_with_results)} completed days{pending_info})")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _detect_pending_days(
    master_data: list[dict],
    days_with_results: list[str],
) -> list[str]:
    """
    Find game days that are pending: ≤ today, have picks submitted, but no
    results yet.  Returns them in GAME_DAYS order.
    """
    completed_set = set(days_with_results)
    today_iso = datetime.now().strftime("%Y-%m-%d")

    pending = []
    for day in GAME_DAYS:
        iso = GAME_DAY_ISO_DATES.get(day, "")
        if not iso or iso > today_iso:
            break  # future day — stop here
        if day in completed_set:
            continue  # already has results
        # Check if any player has a pick for this day
        pick_col = f"Pick {day}"
        has_picks = any(
            row.get(pick_col, "").strip()
            for row in master_data
        )
        if has_picks:
            pending.append(day)

    return pending


def _build_meta(players: list[PlayerRecord], days_with_results: list[str]) -> dict:
    """Build the meta object the frontend hero section reads."""
    alive = sum(1 for p in players if p.still_alive)
    total = len(players)
    current_day_idx = GAME_DAYS.index(days_with_results[-1]) + 1 if days_with_results else 1
    return {
        "pool_name": POOL_NAME,
        "season": POOL_SEASON,
        "entry_fee": POOL_ENTRY_FEE,
        "total_players": total,
        "alive_players": alive,
        "eliminated_players": total - alive,
        "current_day": current_day_idx,   # integer 1-10
        "total_days": len(GAME_DAYS),
        "pot": total * POOL_ENTRY_FEE,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }


def _build_daily_results(
    days_with_results: list[str],
    seeds_by_team: dict[str, int],
    available_by_day: dict[str, list[str]],
    losers_by_day: dict[str, list[str]],
    players: list[PlayerRecord],
    pending_days: list[str] | None = None,
) -> list[dict]:
    """
    Build the daily_results array (one entry per completed + pending day).

    Each entry includes available_teams, winners, losers, upsets, status, and
    per-day stats that the frontend recap text and superlatives cards read.
    Pending days (picks submitted, no results yet) get status="pending".
    """
    results = []
    pending_set = set(pending_days or [])

    # Combine completed and pending days in GAME_DAYS order
    all_days = []
    for day in GAME_DAYS:
        if day in days_with_results or day in pending_set:
            all_days.append(day)

    for day in all_days:
        is_pending = day in pending_set
        espn_date = GAME_DAY_TO_ESPN_DATE.get(day)
        day_num = GAME_DAYS.index(day) + 1

        available = available_by_day.get(day, [])

        if is_pending:
            # Pending day: no results yet, just picks and pick-based stats
            stats = _compute_day_stats(
                day, day_num, players, losers_by_day, seeds_by_team,
                is_pending=True,
            )
            results.append({
                "day": day_num,
                "date": GAME_DAY_ISO_DATES.get(day, ""),
                "label": GAME_DAY_LABELS.get(day, day),
                "status": "pending",
                "available_teams": sorted(available),
                "winners": [],
                "losers": [],
                "upsets": [],
                "stats": stats,
            })
        else:
            # Completed day: full results
            game_results = []
            if espn_date:
                try:
                    game_results = fetch_games_for_day(day, espn_date)
                except RuntimeError:
                    logger.warning(f"Could not fetch ESPN results for {day}")

            losers = losers_by_day.get(day, [])
            losers_set = set(losers)
            winners = [t for t in available if t not in losers_set]

            # Upsets: winner seed > loser seed by ≥ 3
            upsets = []
            for g in game_results:
                if not g.is_final:
                    continue
                winner_seed = seeds_by_team.get(g.winner, 0)
                loser_seed = seeds_by_team.get(g.loser, 0)
                if winner_seed > 0 and loser_seed > 0 and (winner_seed - loser_seed) >= 3:
                    upsets.append({
                        "winner": g.winner,
                        "winner_seed": winner_seed,
                        "loser": g.loser,
                        "loser_seed": loser_seed,
                    })

            stats = _compute_day_stats(day, day_num, players, losers_by_day, seeds_by_team)

            results.append({
                "day": day_num,
                "date": GAME_DAY_ISO_DATES.get(day, ""),
                "label": GAME_DAY_LABELS.get(day, day),
                "status": "final",
                "available_teams": sorted(available),
                "winners": sorted(winners),
                "losers": sorted(losers),
                "upsets": upsets,
                "stats": stats,
            })

    return results


def _compute_day_stats(
    game_day: str,
    day_num: int,
    players: list[PlayerRecord],
    losers_by_day: dict[str, list[str]],
    seeds_by_team: dict[str, int],
    is_pending: bool = False,
) -> dict:
    """
    Compute per-day stats for the frontend recap text and superlative cards.

    Keys must match exactly what app.js reads:
      most_picked_today, biggest_degen_pick, deadliest_team, chalk_king,
      survivors, eliminated

    When is_pending=True, only pick-based stats are computed; result-based
    stats (deadliest_team, chalk_king) return blanks.
    """
    losers_set = set(losers_by_day.get(game_day, []))
    day_idx = GAME_DAYS.index(game_day)

    if is_pending:
        # For pending days, carry forward survivor count from previous day
        # (no one has been eliminated on this day yet)
        prev_day_idx = day_idx - 1
        if prev_day_idx >= 0:
            survivors = sum(
                1 for p in players
                if p.still_alive or (
                    p.eliminated_on and p.eliminated_on in GAME_DAYS
                    and GAME_DAYS.index(p.eliminated_on) > prev_day_idx
                )
            )
        else:
            survivors = len(players)
        eliminated_count = len(players) - survivors
    else:
        # survivors / eliminated: cumulative counts after this day
        survivors = sum(
            1 for p in players
            if p.still_alive or (
                p.eliminated_on and p.eliminated_on in GAME_DAYS
                and GAME_DAYS.index(p.eliminated_on) > day_idx
            )
        )
        eliminated_count = len(players) - survivors

    # most_picked_today: most-picked team on this day + win/loss/pending result
    # Exclude "No Pick" entries and post-elimination picks
    pick_counts: Counter = Counter(
        p.picks.get(game_day)
        for p in players
        if _is_valid_pick(p.picks.get(game_day))
        and not _is_pick_after_elimination(p, game_day)
    )
    if pick_counts:
        most_team, most_count = pick_counts.most_common(1)[0]
        if is_pending:
            most_result = "pending"
        else:
            most_result = "loss" if most_team in losers_set else "win"
        most_picked = {"team": most_team, "count": most_count, "result": most_result}
    else:
        most_picked = {"team": _BLANK_STAT, "count": 0, "result": "pending"}

    if is_pending:
        # For pending days: biggest degen = highest-seed pick (no result filter)
        degen_candidates = [
            (p, p.picks[game_day], seeds_by_team.get(p.picks[game_day], 0))
            for p in players
            if p.still_alive
            and _is_valid_pick(p.picks.get(game_day))
            and seeds_by_team.get(p.picks[game_day], 0) > 0
        ]
        if degen_candidates:
            degen_p, degen_team, degen_seed = max(degen_candidates, key=lambda x: x[2])
            biggest_degen = {
                "player": degen_p.name,
                "team": degen_team,
                "seed": degen_seed,
                "result": "pending",
            }
        else:
            biggest_degen = {
                "player": _BLANK_STAT, "team": _BLANK_STAT,
                "seed": 0, "result": "pending",
            }

        # No results yet — can't determine deadliest or chalk king
        deadliest_stat = {"team": _BLANK_STAT, "kills": 0, "seed": 0}
        chalk_king = {"player": _BLANK_STAT, "team": _BLANK_STAT, "seed": 0}
    else:
        # biggest_degen_pick: alive player with highest-seed correct pick today
        correct_alive = [
            (p, p.picks[game_day], seeds_by_team.get(p.picks[game_day], 0))
            for p in players
            if p.still_alive
            and _is_valid_pick(p.picks.get(game_day))
            and p.picks[game_day] not in losers_set
            and seeds_by_team.get(p.picks[game_day], 0) > 0
        ]
        if correct_alive:
            degen_p, degen_team, degen_seed = max(correct_alive, key=lambda x: x[2])
            biggest_degen = {
                "player": degen_p.name,
                "team": degen_team,
                "seed": degen_seed,
                "result": "win",
            }
        else:
            biggest_degen = {
                "player": _BLANK_STAT,
                "team": _BLANK_STAT,
                "seed": 0,
                "result": "pending",
            }

        # deadliest_team: losing team that eliminated the most players this day
        elim_by_team: Counter = Counter(
            p.picks[game_day]
            for p in players
            if p.eliminated_on == game_day
            and _is_valid_pick(p.picks.get(game_day))
            and p.picks[game_day] in losers_set
        )
        if elim_by_team:
            deadliest, kills = elim_by_team.most_common(1)[0]
            deadliest_stat = {
                "team": deadliest,
                "kills": kills,
                "seed": seeds_by_team.get(deadliest, 0),
            }
        else:
            deadliest_stat = {"team": _BLANK_STAT, "kills": 0, "seed": 0}

        # chalk_king: alive player who picked the lowest-seed (safest) team today
        chalk_candidates = [
            (p, p.picks[game_day], seeds_by_team.get(p.picks[game_day], 99))
            for p in players
            if p.still_alive
            and _is_valid_pick(p.picks.get(game_day))
            and seeds_by_team.get(p.picks[game_day], 0) > 0
        ]
        if chalk_candidates:
            chalk_p, chalk_team, chalk_seed = min(chalk_candidates, key=lambda x: x[2])
            chalk_king = {"player": chalk_p.name, "team": chalk_team, "seed": chalk_seed}
        else:
            chalk_king = {"player": _BLANK_STAT, "team": _BLANK_STAT, "seed": 0}

    return {
        "most_picked_today": most_picked,
        "biggest_degen_pick": biggest_degen,
        "deadliest_team": deadliest_stat,
        "chalk_king": chalk_king,
        "survivors": survivors,
        "eliminated": eliminated_count,
    }


def _build_players_json(
    players: list[PlayerRecord],
    days_with_results: list[str],
    seeds_by_team: dict[str, int],
) -> list[dict]:
    """
    Build the players array for JSON output.

    Schema per player:
      name, status ("alive"/"eliminated"), rank (int), degen_score,
      eliminated_day (int, only if eliminated),
      picks: [{day (int), team, seed, result ("win"/"loss"/"pending")}]
    """
    result = []
    days_with_results_set = set(days_with_results)

    for rank_i, p in enumerate(players):
        picks_array = []
        for day in GAME_DAYS:
            team = p.picks.get(day)
            if not _is_valid_pick(team):
                continue  # skip blank / "No Pick" entries
            if _is_pick_after_elimination(p, day):
                continue  # skip picks submitted after elimination
            day_num = GAME_DAYS.index(day) + 1
            status = p.pick_statuses.get(day)
            if day in days_with_results_set:
                result_str = "loss" if (status and status.is_loser) else "win"
            else:
                result_str = "pending"
            picks_array.append({
                "day": day_num,
                "team": team,
                "seed": seeds_by_team.get(team, 0),
                "result": result_str,
            })

        entry: dict = {
            "name": p.name,
            "status": "alive" if p.still_alive else "eliminated",
            "rank": rank_i + 1,
            "degen_score": p.seed_score,
            "picks": picks_array,
        }
        if not p.still_alive and p.eliminated_on and p.eliminated_on in GAME_DAYS:
            entry["eliminated_day"] = GAME_DAYS.index(p.eliminated_on) + 1

        result.append(entry)

    return result


def _build_survival_curve(
    players: list[PlayerRecord],
    days_with_results: list[str],
) -> list[dict]:
    """
    Build a survival curve: one data point per completed game day showing
    how many players were still alive after that day's results.
    """
    curve = []
    days_with_results_set = set(days_with_results)

    # Day 0: everyone starts alive
    total = len(players)
    curve.append({"day": "Start", "alive": total, "label": "Day 0 (Start)"})

    for i, day in enumerate(GAME_DAYS):
        if day not in days_with_results_set:
            break
        day_idx = i
        # A player was alive after this day if they are currently alive OR
        # they were eliminated on a later day
        alive = sum(
            1 for p in players
            if p.still_alive or (
                p.eliminated_on and p.eliminated_on in GAME_DAYS
                and GAME_DAYS.index(p.eliminated_on) > day_idx
            )
        )
        curve.append({
            "day": day,
            "alive": alive,
            "label": f"Day {i + 1} ({day})",
        })

    return curve


def _compute_predictions(
    players: list[PlayerRecord],
    seeds_by_team: dict[str, int],
    days_with_results: list[str],
    losers_by_day: dict[str, list[str]] | None = None,
) -> dict:
    """
    Compute predictions & risk data.

    - remaining_teams_by_player: for each alive player, tournament-surviving teams
      they have NOT yet used (excludes teams eliminated from the bracket)
    - pick_overlap: for each surviving team, {"times_used": N, "alive_users_used": N}
    """
    # Build set of all teams eliminated from the tournament
    all_losers: set[str] = set()
    if losers_by_day:
        for day_losers in losers_by_day.values():
            all_losers.update(day_losers)

    # Only count teams still alive in the tournament
    surviving_teams = sorted(t for t in seeds_by_team if t not in all_losers)
    alive = [p for p in players if p.still_alive]

    def _used_teams(player: PlayerRecord) -> set[str]:
        """Teams used by this player across completed days (valid picks only)."""
        return {
            player.picks[day]
            for day in days_with_results
            if _is_valid_pick(player.picks.get(day))
            and not _is_pick_after_elimination(player, day)
        }

    # remaining_teams_by_player: surviving tournament teams minus already-used picks
    remaining_teams: dict[str, list[str]] = {}
    for p in alive:
        used = _used_teams(p)
        remaining_teams[p.name] = sorted(t for t in surviving_teams if t not in used)

    # pick_overlap: alive-only count (for the filter in the frontend)
    alive_overlap: Counter = Counter()
    for p in alive:
        for team in _used_teams(p):
            alive_overlap[team] += 1

    # total usage across all players (alive + eliminated)
    total_overlap: Counter = Counter()
    for p in players:
        for team in _used_teams(p):
            total_overlap[team] += 1

    pick_overlap = {
        team: {
            "times_used": total_overlap.get(team, 0),
            "alive_users_used": alive_overlap.get(team, 0),
        }
        for team in surviving_teams
    }

    return {
        "remaining_teams_by_player": remaining_teams,
        "pick_overlap": pick_overlap,
    }
