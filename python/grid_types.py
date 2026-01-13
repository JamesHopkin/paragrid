"""
Shared type definitions for the paragrid system.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Direction(Enum):
    """Cardinal direction for traversal."""

    N = "N"  # Up (decreasing row)
    S = "S"  # Down (increasing row)
    E = "E"  # Right (increasing col)
    W = "W"  # Left (decreasing col)


# =============================================================================
# Grid Definition Types
# =============================================================================


@dataclass(frozen=True)
class Empty:
    """An empty cell."""

    pass


@dataclass(frozen=True)
class Concrete:
    """A cell containing a concrete value."""

    id: str


@dataclass(frozen=True)
class Ref:
    """A cell referencing another grid."""

    grid_id: str
    is_primary: bool | None = None  # None = auto-determine, True/False = explicit


Cell = Empty | Concrete | Ref


@dataclass(frozen=True)
class Grid:
    """A 2D grid of cells."""

    id: str
    cells: tuple[tuple[Cell, ...], ...]

    @property
    def rows(self) -> int:
        return len(self.cells)

    @property
    def cols(self) -> int:
        return len(self.cells[0]) if self.cells else 0


GridStore = dict[str, Grid]
