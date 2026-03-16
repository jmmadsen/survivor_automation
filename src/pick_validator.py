from src.config import GAME_DAYS
from src.models import PickStatus, PlayerRecord


def validate_picks_for_player(
    player: PlayerRecord,
    losers_by_day: dict[str, list[str]],
    available_by_day: dict[str, list[str]],
    game_days_played: list[str],
) -> dict[str, PickStatus]:
    """
    For each completed game day, determine the status of a player's pick.
    Returns {game_day: PickStatus}.
    """
    seen_teams: set[str] = set()
    statuses: dict[str, PickStatus] = {}

    for day in game_days_played:
        pick = player.picks.get(day)
        if pick:
            pick = pick.strip() or None

        is_duplicate = bool(pick and pick in seen_teams)
        is_valid = bool(pick and pick in available_by_day.get(day, []))
        is_loser = bool(pick and pick in losers_by_day.get(day, []))

        if pick:
            seen_teams.add(pick)

        statuses[day] = PickStatus(
            game_day=day,
            picked_team=pick,
            is_loser=is_loser,
            is_valid=is_valid,
            is_duplicate=is_duplicate,
        )

    return statuses


def determine_elimination(
    statuses: dict[str, PickStatus],
    game_days_played: list[str],
) -> tuple[bool, str | None]:
    """
    Determine if a player is eliminated and on which day.
    A player is eliminated on the first day their pick is a loser.
    Returns (is_eliminated, eliminated_on_day).
    """
    for day in game_days_played:
        status = statuses.get(day)
        if status and status.is_loser:
            return True, day
    return False, None


def check_duplicate_picks(players: list[PlayerRecord]) -> dict[str, list[tuple[str, str]]]:
    """
    Check for players who picked the same team more than once across all game days.
    Returns {player_name: [(game_day, team), ...]} for players with duplicates.
    """
    violations: dict[str, list[tuple[str, str]]] = {}
    for player in players:
        seen: dict[str, str] = {}  # team → first game day
        dupes: list[tuple[str, str]] = []
        for day in GAME_DAYS:
            pick = player.picks.get(day)
            if not pick:
                continue
            if pick in seen:
                dupes.append((day, pick))
            else:
                seen[pick] = day
        if dupes:
            violations[player.name] = dupes
    return violations
