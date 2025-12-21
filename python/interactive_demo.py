"""
Interactive demo for Paragrid with push operations.
Display a grid and allow pushing cells with keyboard commands.
"""

from fractions import Fraction

import readchar
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.text import Text

from paragrid import (
    CellPosition,
    Concrete,
    Direction,
    Empty,
    Grid,
    GridStore,
    Ref,
    analyze,
    push,
    push_simple,
    render,
)


class InteractiveDemo:
    """Interactive demo for push operations."""

    def __init__(self, store: GridStore, start_grid: str) -> None:
        self.store = store
        self.current_grid = start_grid
        # Start at top-left of the starting grid
        self.push_row = 0
        self.push_col = 0
        self.direction = Direction.E
        self.console = Console()
        self.status_message = "Ready"

    def try_enter(self, grid_id: str, direction: Direction) -> CellPosition | None:
        """Standard entry function - enter from the edge based on direction."""
        if grid_id not in self.store:
            return None
        grid = self.store[grid_id]
        match direction:
            case Direction.N:
                return CellPosition(grid_id, grid.rows - 1, 0)
            case Direction.S:
                return CellPosition(grid_id, 0, 0)
            case Direction.E:
                return CellPosition(grid_id, 0, 0)
            case Direction.W:
                return CellPosition(grid_id, 0, grid.cols - 1)

    def generate_display(self) -> Panel:
        """Generate the current display with grid and status."""
        # Analyze and render current grid
        tree = analyze(self.store, self.current_grid, Fraction(1), Fraction(1))
        grid_text = render(tree)

        # Add status information
        status = Text()
        status.append(f"Push Position: ", style="bold")
        status.append(f"{self.current_grid}[{self.push_row}, {self.push_col}]\n")
        status.append(f"Direction: ", style="bold")
        status.append(f"{self.direction.value}\n\n")

        # Get current cell info
        grid = self.store[self.current_grid]
        if 0 <= self.push_row < grid.rows and 0 <= self.push_col < grid.cols:
            cell = grid.cells[self.push_row][self.push_col]
            cell_str = (
                f"Empty" if isinstance(cell, Empty)
                else f"Ref({cell.grid_id})" if isinstance(cell, Ref)
                else f"Concrete({cell.id})"
            )
            status.append(f"Current Cell: ", style="bold")
            status.append(f"{cell_str}\n\n")

        # Convert ANSI-colored grid text to Rich Text properly
        grid_rich_text = Text.from_ansi(grid_text)
        status.append(grid_rich_text)
        status.append("\n\n")
        status.append("Keys:\n", style="bold cyan")
        status.append("  SPACE - Push in current direction\n")
        status.append("  WASD - Move push position\n")
        status.append("  ↑↓←→ - Change direction\n")
        status.append("  Q - Quit\n\n")

        # Status line at the bottom
        status.append("─" * 60 + "\n", style="dim")
        status.append("Status: ", style="bold")
        status.append(self.status_message)

        return Panel(status, title="Paragrid Interactive Push Demo", border_style="green")

    def move_position(self, dr: int, dc: int) -> None:
        """Move push position by delta, wrapping within grid bounds."""
        grid = self.store[self.current_grid]
        old_row, old_col = self.push_row, self.push_col
        self.push_row = (self.push_row + dr) % grid.rows
        self.push_col = (self.push_col + dc) % grid.cols
        self.status_message = f"Moved to [{self.push_row}, {self.push_col}]"

    def attempt_push(self) -> None:
        """Attempt to push from current position in current direction."""
        start = CellPosition(self.current_grid, self.push_row, self.push_col)
        result = push(self.store, start, self.direction, self.try_enter)

        if result:
            # Push succeeded - update store and follow the pushed content
            self.store = result

            # Move the push position in the direction of the push
            # This makes the push position "follow" what was pushed
            match self.direction:
                case Direction.N:
                    self.push_row = (self.push_row - 1) % self.store[self.current_grid].rows
                case Direction.S:
                    self.push_row = (self.push_row + 1) % self.store[self.current_grid].rows
                case Direction.E:
                    self.push_col = (self.push_col + 1) % self.store[self.current_grid].cols
                case Direction.W:
                    self.push_col = (self.push_col - 1) % self.store[self.current_grid].cols

            self.status_message = f"✓ Push {self.direction.value} successful!"
        else:
            self.status_message = f"✗ Push {self.direction.value} failed - no valid path or empty space"

    def run(self) -> None:
        """Run the interactive demo with immediate key press handling."""
        with Live(self.generate_display(), console=self.console, refresh_per_second=4) as live:
            try:
                while True:
                    # Update display
                    live.update(self.generate_display())

                    # Get single key press
                    key = readchar.readkey()

                    # Handle key press
                    if key.lower() == 'q':
                        self.status_message = "Quitting..."
                        live.update(self.generate_display())
                        break
                    elif key == ' ':  # Space bar for push
                        self.attempt_push()
                    # WASD for movement
                    elif key.lower() == 'w':
                        self.move_position(-1, 0)
                    elif key.lower() == 's':
                        self.move_position(1, 0)
                    elif key.lower() == 'a':
                        self.move_position(0, -1)
                    elif key.lower() == 'd':
                        self.move_position(0, 1)
                    # Arrow keys for direction
                    elif key == readchar.key.UP:
                        self.direction = Direction.N
                        self.status_message = "Direction set to North"
                    elif key == readchar.key.DOWN:
                        self.direction = Direction.S
                        self.status_message = "Direction set to South"
                    elif key == readchar.key.LEFT:
                        self.direction = Direction.W
                        self.status_message = "Direction set to West"
                    elif key == readchar.key.RIGHT:
                        self.direction = Direction.E
                        self.status_message = "Direction set to East"
                    else:
                        self.status_message = f"Unknown key: {repr(key)}"

            except KeyboardInterrupt:
                self.status_message = "Interrupted by user"
                live.update(self.generate_display())


def main() -> None:
    """Run interactive demo with a sample grid setup."""
    # Create a simple test grid with room to push
    store: GridStore = {
        "main": Grid(
            "main",
            (
                (Concrete("A"), Concrete("B"), Concrete("C"), Empty()),
                (Concrete("D"), Ref("inner"), Concrete("F"), Empty()),
                (Concrete("G"), Concrete("H"), Concrete("I"), Empty()),
            ),
        ),
        "inner": Grid(
            "inner",
            (
                (Concrete("1"), Concrete("2")),
                (Concrete("3"), Concrete("4")),
            ),
        ),
    }

    demo = InteractiveDemo(store, "main")
    demo.run()


if __name__ == "__main__":
    main()
