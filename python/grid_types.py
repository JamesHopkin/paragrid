"""
Shared type definitions for the paragrid system.
"""

from enum import Enum


class Direction(Enum):
    """Cardinal direction for traversal."""

    N = "N"  # Up (decreasing row)
    S = "S"  # Down (increasing row)
    E = "E"  # Right (increasing col)
    W = "W"  # Left (decreasing col)
