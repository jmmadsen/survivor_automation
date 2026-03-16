from dataclasses import dataclass, field
from typing import Optional


@dataclass
class GameResult:
    game_day: str
    winner: str
    loser: str
    winner_score: int
    loser_score: int
    is_final: bool
    status: str = ""


@dataclass
class PickStatus:
    game_day: str
    picked_team: Optional[str]
    is_loser: bool
    is_valid: bool
    is_duplicate: bool


@dataclass
class PlayerRecord:
    name: str
    email: str
    paid: bool
    picks: dict = field(default_factory=dict)          # {game_day: team_name or None}
    pick_statuses: dict = field(default_factory=dict)  # {game_day: PickStatus}
    is_eliminated: bool = False
    eliminated_on: Optional[str] = None
    still_alive: bool = True
