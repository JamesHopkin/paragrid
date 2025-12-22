"""
Interactive demo for Paragrid with push operations.
Display a grid and allow pushing cells with keyboard commands.
"""

from fractions import Fraction
import logging

import readchar, sys
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
    TagFn,
    analyze,
    parse_grids,
    push,
    push_simple,
    render,
)


class InteractiveDemo:
    """Interactive demo for push operations."""

    def __init__(self, store: GridStore, start_grid: str, tag_fn: TagFn | None = None) -> None:
        self.store = store
        self.original_store = store  # Keep a copy of the original state
        self.current_grid = start_grid
        self.tag_fn = tag_fn
        # Start at top-left of the starting grid
        self.push_row = 0
        self.push_col = 0
        self.direction = Direction.E
        self.console = Console()
        self.status_message = "Ready"

    def try_enter(self, grid_id: str, direction: Direction) -> CellPosition | None:
        """Standard entry function - enter at middle of edge based on direction."""
        if grid_id not in self.store:
            return None
        grid = self.store[grid_id]
        match direction:
            case Direction.N:
                return CellPosition(grid_id, grid.rows - 1, grid.cols // 2)
            case Direction.S:
                return CellPosition(grid_id, 0, grid.cols // 2)
            case Direction.E:
                return CellPosition(grid_id, grid.rows // 2, 0)
            case Direction.W:
                return CellPosition(grid_id, grid.rows // 2, grid.cols - 1)

    def generate_display(self) -> Panel:
        """Generate the current display with grid and status."""
        # Analyze and render current grid
        tree = analyze(self.store, self.current_grid, Fraction(1), Fraction(1))
        highlight_pos = CellPosition(self.current_grid, self.push_row, self.push_col)
        grid_text = render(tree, max_scale=3000, highlight_pos=highlight_pos)

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
        status.append("  R - Reset to original grid\n")
        status.append("  Q - Quit\n\n")

        # Status line at the bottom
        status.append("─" * 40 + "\n", style="dim")
        status.append("Status: ", style="bold")
        status.append(self.status_message)

        return Panel(status, title="Paragrid Interactive Push Demo", border_style="green", width=50)

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
        result = push(self.store, start, self.direction, self.try_enter, self.tag_fn)

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

    def reset_grid(self) -> None:
        """Reset the grid to its original state."""
        self.store = self.original_store
        self.status_message = "Grid reset to original state"

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
                    elif key.lower() == 'r':  # Reset grid
                        self.reset_grid()
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

def create_demo_store() -> GridStore:
    """Create the demo grid store."""
    # return {
    #     "main": Grid(
    #         "main",
    #         (
    #             (Concrete("A"), Concrete("B"), Concrete("C"), Empty()),
    #             (Concrete("D"), Ref("inner"), Concrete("F"), Empty()),
    #             (Concrete("G"), Concrete("H"), Concrete("I"), Empty()),
    #         ),
    #     ),
    #     "inner": Grid(
    #         "inner",
    #         (
    #             (Concrete("1"), Concrete("2")),
    #             (Concrete("3"), Concrete("4")),
    #         ),
    #     ),
    # }

    return parse_grids({
        'main': '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ _ _ _ _ _ 9|9 _ main _ _ inner _ 9|9 _ _ _ _ _ _ _|9 _ 1 _ _ _ _ 9|9 _ _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
        'inner': '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'
    })


def main() -> None:
    """Run interactive demo with a sample grid setup."""
    store = create_demo_store()
    demo = InteractiveDemo(store, "main",
        lambda cell: ({"stop"} if isinstance(cell, Concrete) and cell.id == 's' else set())
    )
    demo.run()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == 'sublime':
        # Running from IDE - just render the initial state
        # Configure logging to see scale computation
        logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

        print('Running from IDE - rendering initial state')
        print()

        # Use the same demo store as the interactive mode
        store = create_demo_store()

        # Analyze and render the initial grid with reasonable scale for IDE viewing
        tree = analyze(store, "main", Fraction(80), Fraction(40))
        output = render(tree, max_scale=3000)  # Reasonable scale for IDE (produces ~2400x2400)
        # Limit output to first 100 lines for IDE viewing
        lines = output.split('\n')
        limited_output = '\n'.join(lines[:100])
        if len(lines) > 100:
            limited_output += f'\n... [{len(lines) - 100} more lines truncated for IDE viewing]'
        print(limited_output)
    else:
        main()
