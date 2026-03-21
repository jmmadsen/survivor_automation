"""
Export survivor pool data as JSON for the GitHub Pages dashboard.

Reads the same Google Sheets data the existing workflow uses, repackages
it as a single JSON file, and writes to disk.  Does NOT modify any
existing sheet or module.
"""

import json
import logging
from collections import Counter
from datetime import datetime, timezone

from src.config import GAME_DAYS, GAME_DAY_TO_ESPN_DATE
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
    detect_days_with_results,
)
from src.sheets_client import SheetsClient

logger = logging.getLogger(__name__)


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
    days_with_results = detect_days_with_results(client)

    # Build and sort player records (seeds_by_team is the 5th arg -- critical
    # for degen scores to be non-zero)
    players = _build_player_records(
        master_data, available_by_day, losers_by_day,
        days_with_results, seeds_by_team,
    )
    players_sorted = _sort_players(players)

    # ---- 2. Determine current day -----------------------------------------
    current_day = days_with_results[-1] if days_with_results else GAME_DAYS[0]

    # ---- 3. Build daily_results with upset detection -----------------------
    daily_results = _build_daily_results(days_with_results, seeds_by_team)

    # ---- 4. Compute stats --------------------------------------------------
    stats = _compute_stats(
        players_sorted, days_with_results, losers_by_day, seeds_by_team,
    )

    # ---- 5. Build players array --------------------------------------------
    players_json = _build_players_json(players_sorted, days_with_results, seeds_by_team)

    # ---- 6. Compute predictions & risk data --------------------------------
    predictions = _compute_predictions(players_sorted, seeds_by_team, days_with_results)

    # ---- 7. Assemble and write JSON ----------------------------------------
    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "current_day": current_day,
        "game_days": GAME_DAYS,
        "players": players_json,
        "daily_results": daily_results,
        "team_seeds": seeds_by_team,
        "stats": stats,
        "predictions": predictions,
    }

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)

    print(f"Exported site data to {output_path} "
          f"({len(players_sorted)} players, {len(days_with_results)} completed days)")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_daily_results(
    days_with_results: list[str],
    seeds_by_team: dict[str, int],
) -> dict[str, list[dict]]:
    """
    For each completed day, fetch game results from ESPN and tag upsets.

    An upset is where the winner's seed number exceeds the loser's seed
    number by >= 3 (higher seed number = bigger underdog).
    """
    daily: dict[str, list[dict]] = {}

    for day in days_with_results:
        espn_date = GAME_DAY_TO_ESPN_DATE.get(day)
        if not espn_date:
            continue

        try:
            game_results = fetch_games_for_day(day, espn_date)
        except RuntimeError:
            logger.warning(f"Could not fetch ESPN results for {day}")
            game_results = []

        games: list[dict] = []
        for result in game_results:
            if not result.is_final:
                continue

            winner_seed = seeds_by_team.get(result.winner, 0)
            loser_seed = seeds_by_team.get(result.loser, 0)
            seed_diff = winner_seed - loser_seed
            is_upset = seed_diff >= 3

            games.append({
                "winner": result.winner,
                "loser": result.loser,
                "winner_score": result.winner_score,
                "loser_score": result.loser_score,
                "winner_seed": winner_seed,
                "loser_seed": loser_seed,
                "is_upset": is_upset,
            })

        daily[day] = games

    return daily


def _compute_stats(
    players: list[PlayerRecord],
    days_with_results: list[str],
    losers_by_day: dict[str, list[str]],
    seeds_by_team: dict[str, int],
) -> dict:
    """Compute aggregate statistics for the pool."""
    total_players = len(players)
    alive = [p for p in players if p.still_alive]
    alive_count = len(alive)

    stats: dict = {
        "total_players": total_players,
        "alive_count": alive_count,
        "most_picked_today": None,
        "biggest_degen_pick": None,
        "deadliest_team": None,
        "chalk_king": None,
        "degen_king": None,
        "most_popular_pick_per_day": {},
    }

    if not days_with_results:
        return stats

    # --- most_picked_today: team with most picks on latest completed day ---
    latest_day = days_with_results[-1]
    day_picks: list[str] = [
        p.picks.get(latest_day)
        for p in players
        if p.picks.get(latest_day)
    ]
    if day_picks:
        pick_counts = Counter(day_picks)
        team, count = pick_counts.most_common(1)[0]
        stats["most_picked_today"] = {"team": team, "count": count}

    # --- biggest_degen_pick: among correct picks on latest day, highest seed ---
    losers_latest = set(losers_by_day.get(latest_day, []))
    correct_picks_latest = [
        p.picks[latest_day]
        for p in players
        if p.picks.get(latest_day) and p.picks[latest_day] not in losers_latest
    ]
    if correct_picks_latest and seeds_by_team:
        degen_pick = max(correct_picks_latest, key=lambda t: seeds_by_team.get(t, 0))
        seed = seeds_by_team.get(degen_pick, 0)
        if seed > 0:
            stats["biggest_degen_pick"] = {"team": degen_pick, "seed": seed}

    # --- deadliest_team: losing team picked by the most eliminated players ---
    elim_counts: Counter = Counter()
    for day in days_with_results:
        losers_set = set(losers_by_day.get(day, []))
        for p in players:
            if not p.still_alive and p.eliminated_on == day:
                pick = p.picks.get(day)
                if pick and pick in losers_set:
                    elim_counts[pick] += 1
    if elim_counts:
        team, count = elim_counts.most_common(1)[0]
        stats["deadliest_team"] = {"team": team, "eliminated_count": count}

    # --- chalk_king: alive player with lowest avg seed across all picks ---
    # --- degen_king: alive player with highest avg seed across all picks ---
    if alive and seeds_by_team:
        def _avg_seed(player: PlayerRecord) -> float:
            picked_seeds = [
                seeds_by_team.get(player.picks[day], 0)
                for day in days_with_results
                if player.picks.get(day) and seeds_by_team.get(player.picks[day], 0) > 0
            ]
            return sum(picked_seeds) / len(picked_seeds) if picked_seeds else 0.0

        alive_with_avg = [(p, _avg_seed(p)) for p in alive]
        alive_with_avg = [(p, avg) for p, avg in alive_with_avg if avg > 0]

        if alive_with_avg:
            chalk = min(alive_with_avg, key=lambda x: x[1])
            degen = max(alive_with_avg, key=lambda x: x[1])
            stats["chalk_king"] = {
                "name": chalk[0].name,
                "avg_seed": round(chalk[1], 2),
            }
            stats["degen_king"] = {
                "name": degen[0].name,
                "avg_seed": round(degen[1], 2),
            }

    # --- most_popular_pick_per_day ---
    for day in days_with_results:
        picks_for_day = [
            p.picks.get(day)
            for p in players
            if p.picks.get(day)
        ]
        if picks_for_day:
            pick_counts = Counter(picks_for_day)
            team, count = pick_counts.most_common(1)[0]
            stats["most_popular_pick_per_day"][day] = {"team": team, "count": count}

    return stats


def _build_players_json(
    players: list[PlayerRecord],
    days_with_results: list[str],
    seeds_by_team: dict[str, int],
) -> list[dict]:
    """Build the players array for JSON output."""
    result = []
    for p in players:
        picks: dict[str, dict | None] = {}
        for day in GAME_DAYS:
            team = p.picks.get(day)
            if team:
                status = p.pick_statuses.get(day)
                is_correct = bool(
                    status and status.picked_team and not status.is_loser
                ) if day in days_with_results else None
                picks[day] = {
                    "team": team,
                    "is_correct": is_correct,
                    "seed": seeds_by_team.get(team, 0),
                }
            else:
                picks[day] = None

        result.append({
            "name": p.name,
            "alive": p.still_alive,
            "eliminated_on": p.eliminated_on,
            "degen_score": p.seed_score,
            "picks": picks,
        })

    return result


def _compute_predictions(
    players: list[PlayerRecord],
    seeds_by_team: dict[str, int],
    days_with_results: list[str],
) -> dict:
    """
    Compute predictions & risk data.

    - remaining_teams: for each alive player, teams they have NOT yet used
    - pick_overlap: for each team, how many alive players have already used it
    """
    all_teams = sorted(seeds_by_team.keys())
    alive = [p for p in players if p.still_alive]

    # Teams each alive player has already used (across completed days only)
    def _used_teams(player: PlayerRecord) -> set[str]:
        return {
            player.picks[day]
            for day in days_with_results
            if player.picks.get(day)
        }

    # remaining_teams per alive player
    remaining_teams: dict[str, list[str]] = {}
    for p in alive:
        used = _used_teams(p)
        remaining_teams[p.name] = sorted(t for t in all_teams if t not in used)

    # pick_overlap: for each team, count of alive players who have used it
    overlap_counter: Counter = Counter()
    for p in alive:
        for team in _used_teams(p):
            overlap_counter[team] += 1
    pick_overlap = {team: overlap_counter.get(team, 0) for team in all_teams}

    return {
        "remaining_teams": remaining_teams,
        "pick_overlap": pick_overlap,
    }
