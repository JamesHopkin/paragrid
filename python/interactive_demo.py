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
    RuleSet,
    Cell,
    CellPosition,
    Concrete,
    Direction,
    Empty,
    Grid,
    GridStore,
    PushFailure,
    Ref,
    TagFn,
    analyze,
    find_tagged_cell,
    parse_grids,
    push,
    push_simple,
    render,
)


class InteractiveDemo:
    """Interactive demo for push operations."""

    def __init__(self, store: GridStore, tag_fn: TagFn | None = None) -> None:
        self.store = store
        self.original_store = store  # Keep a copy of the original state
        self.tag_fn = tag_fn
        self.player_tag = "player"
        self.console = Console()
        self.status_message = "Ready"

    @property
    def player_position(self) -> CellPosition | None:
        """Dynamically find current player position."""
        if self.tag_fn is None:
            return None
        return find_tagged_cell(self.store, self.player_tag, self.tag_fn)

    def generate_display(self) -> Panel:
        """Generate the current display with grid and status."""
        player_pos = self.player_position

        if player_pos is None:
            # Show error state
            status = Text()
            status.append("ERROR: No player cell found!\n", style="bold red")
            status.append("Please ensure a cell is tagged 'player' in your grid.\n")
            return Panel(status, title="Paragrid - Error", border_style="red")

        # Analyze and render with player's grid
        tree = analyze(self.store, player_pos.grid_id, Fraction(1), Fraction(1))
        grid_text = render(tree, max_scale=100, highlight_pos=player_pos)

        # Add status information
        status = Text()
        status.append(f"Player Position: ", style="bold")
        status.append(f"{player_pos.grid_id}[{player_pos.row}, {player_pos.col}]\n\n")

        # Get current cell info
        grid = self.store[player_pos.grid_id]
        cell = grid.cells[player_pos.row][player_pos.col]
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
        status.append("  W - Push North\n")
        status.append("  A - Push West\n")
        status.append("  S - Push South\n")
        status.append("  D - Push East\n")
        status.append("  R - Reset to original grid\n")
        status.append("  Q - Quit\n\n")

        # Status line at the bottom
        status.append("─" * 40 + "\n", style="dim")
        status.append("Status: ", style="bold")
        status.append(self.status_message)

        return Panel(status, title="Paragrid Interactive Push Demo", border_style="green", width=80)

    def attempt_push(self, direction: Direction) -> None:
        """Attempt to push from player position in given direction."""
        player_pos = self.player_position

        if player_pos is None:
            self.status_message = "ERROR: No player cell found!"
            return

        result = push(self.store, player_pos, direction, RuleSet(), self.tag_fn)

        if isinstance(result, PushFailure):
            # Push failed - display failure reason
            self.status_message = (
                f"✗ Push {direction.value} failed: {result.reason}"
                f" at {result.position.grid_id}[{result.position.row}, {result.position.col}]"
            )
            if result.details:
                self.status_message += f" ({result.details})"
        else:
            # Success - update store (player has moved with the push)
            self.store = result

            # Re-find player at new position
            new_pos = self.player_position
            if new_pos:
                self.status_message = (
                    f"✓ Pushed {direction.value}! Player now at "
                    f"{new_pos.grid_id}[{new_pos.row}, {new_pos.col}]"
                )
            else:
                self.status_message = "✓ Push succeeded but player lost!"

    def reset_grid(self) -> None:
        """Reset the grid to its original state."""
        self.store = self.original_store
        self.status_message = "Grid reset to original state"

    def run(self) -> None:
        """Run the interactive demo with player-based controls."""
        # Startup check
        if self.player_position is None:
            print("ERROR: No player cell found in grid!")
            print("Please ensure a cell is tagged 'player'.")
            return

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
                    elif key.lower() == 'r':  # Reset grid
                        self.reset_grid()
                    # WASD for directional pushes
                    elif key.lower() == 'w':
                        self.attempt_push(Direction.N)
                    elif key.lower() == 's':
                        self.attempt_push(Direction.S)
                    elif key.lower() == 'a':
                        self.attempt_push(Direction.W)
                    elif key.lower() == 'd':
                        self.attempt_push(Direction.E)
                    else:
                        self.status_message = f"Unknown key: {repr(key)}"

            except KeyboardInterrupt:
                self.status_message = "Interrupted by user"
                live.update(self.generate_display())

LAYOUTS = dict(
    swap = dict(
        main = '9 9 9 9 9 9 9 9|9 _ _ _ _ _ _ 9|9 _ 2 _ _ _ _ 9|9 _ main _ _ *inner _ 9|9 _ _ _ _ _ _ _|9 _ 1 _ _ _ _ 9|9 ~inner _ _ 9 _ _ 9|9 9 9 9 9 9 9 9',
        inner = '9 9 _ 9 9|9 _ _ _ 9|9 _ _ _ 9|9 _ _ _ 9|9 9 9 9 9'
    ),
    bug = dict(main = '1 inner 2 9', inner = '9 9|9 _|9 9')
)

def main(store: GridStore) -> None:
    """Run interactive demo with a sample grid setup."""
    def tag_fn(cell: Cell) -> set[str]:
        if isinstance(cell, Concrete):
            if cell.id == '1':
                return {"player"}
            elif cell.id == '9':
                return {"stop"}
        return set()

    demo = InteractiveDemo(store, tag_fn=tag_fn)
    demo.run()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == 'sublime':
        # Running from IDE - just render the initial state
        # Configure logging to see scale computation
        logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

        print('Running from IDE - rendering initial state')
        print()

        store = parse_grids(LAYOUTS['bug']) 
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
        store = parse_grids(LAYOUTS[sys.argv[1] if len(sys.argv) > 1 else 'swap'])
        main(store)
