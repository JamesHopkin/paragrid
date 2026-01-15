/**
 * Parse grid definitions from compact string format.
 */

import { Cell, Empty, Concrete, Ref, Grid, GridStore, createGrid } from '../core/types.js';
import type { TagFn } from '../tagging/types.js';

/**
 * Extract the core ID from a concrete cell ID that may have a unique suffix.
 *
 * When using unique ID generation, concrete cells get IDs like "2@gridId:row:col".
 * This function extracts the core value "2" for use in mappings (colors, shapes, etc.).
 *
 * @param cellId - The cell ID (e.g., "2" or "2@grid:0:1")
 * @returns The core ID without the unique suffix (e.g., "2")
 *
 * @example
 * getCoreId("2") // Returns "2"
 * getCoreId("2@main:0:1") // Returns "2"
 * getCoreId("1") // Returns "1"
 * getCoreId("123abc@grid:5:3") // Returns "123abc"
 */
export function getCoreId(cellId: string): string {
  return cellId.split('@')[0];
}

/**
 * Function to generate IDs for concrete cells during parsing.
 *
 * @param cellStr - The cell string from the definition (e.g., "1", "123")
 * @param gridId - The grid ID this cell belongs to
 * @param row - The row index of the cell
 * @param col - The column index of the cell
 * @returns The ID to use for the Concrete cell
 */
export type ConcreteIdFn = (cellStr: string, gridId: string, row: number, col: number) => string;

/**
 * Create a ConcreteIdFn that generates unique IDs for cells, except for cells
 * with specific tags (e.g., 'player' or 'stop') which keep their original IDs.
 *
 * Non-special cells get unique IDs in the format: "value@gridId:row:col"
 * Special cells (determined by tagFn) keep their original value as the ID.
 *
 * @param tagFn - Function to determine tags for a cell
 * @param specialTags - Set of tag names that should preserve original IDs (e.g., ['player', 'stop'])
 * @returns A ConcreteIdFn suitable for use with parseGrids
 */
export function makeUniqueIdGenerator(tagFn: TagFn, specialTags: Set<string>): ConcreteIdFn {
  const playerCells = new Set<string>();

  return (cellStr: string, gridId: string, row: number, col: number): string => {
    // Create a temporary concrete cell to check its tags
    const tempCell = Concrete(cellStr);
    const tags = tagFn(tempCell);

    // Check if this cell has any special tags
    const hasSpecialTag = Array.from(tags).some(tag => specialTags.has(tag));

    if (hasSpecialTag) {
      // Track player cells for duplicate warning
      if (tags.has('player')) {
        if (playerCells.size > 0) {
          console.warn(
            `Warning: Multiple player cells detected. ` +
            `Found player at ${gridId}[${row},${col}], but player already exists at: ` +
            Array.from(playerCells).join(', ')
          );
        }
        playerCells.add(`${gridId}[${row},${col}]`);
      }

      // Keep original ID for special cells
      return cellStr;
    }

    // Generate unique ID for non-special cells
    return `${cellStr}@${gridId}:${row}:${col}`;
  };
}

/**
 * Parse grid definitions from a compact string format.
 *
 * Format:
 * - Rows separated by |
 * - Cells separated by spaces
 * - Cell type determined by FIRST CHARACTER (allows multi-character content/refs):
 *   * First char is digit (0-9): Concrete cell with entire string as content
 *     Examples: "1" -> Concrete("1"), "123abc" -> Concrete("123abc")
 *   * First char is letter (a-zA-Z): Ref cell with entire string as grid_id (auto-determined primary)
 *     Examples: "A" -> Ref("A"), "Main" -> Ref("Main"), "Grid2" -> Ref("Grid2")
 *   * First char is '*': Primary ref, remainder is grid_id (must have at least 1 char after *)
 *     Examples: "*A" -> Ref("A", is_primary=True), "*Main" -> Ref("Main", is_primary=True)
 *   * First char is '~': Secondary ref, remainder is grid_id (must have at least 1 char after ~)
 *     Examples: "~A" -> Ref("A", is_primary=False), "~Grid2" -> Ref("Grid2", is_primary=False)
 *   * Underscore only (_): Empty cell
 *   * Empty string (from multiple adjacent spaces): Empty cell
 *
 * Example:
 *     {
 *         "main": "123 abc|xyz *Main",
 *         "Main": "5|6"
 *     }
 *     Creates:
 *     - Grid "main": 2x2 with [Concrete("123"), Concrete("abc")], [Concrete("xyz"), Ref("Main", is_primary=True)]
 *     - Grid "Main": 2x1 with [Concrete("5")], [Concrete("6")]
 *
 * @param definitions - Object mapping grid_id to string definition
 * @param concreteIdFn - Optional function to generate IDs for concrete cells. Defaults to using cellStr as-is.
 * @returns GridStore with parsed grids
 * @throws Error if parsing fails with detailed diagnostic information
 */
export function parseGrids(
  definitions: Record<string, string>,
  concreteIdFn?: ConcreteIdFn
): GridStore {
  const store: { [gridId: string]: Grid } = {};

  for (const [gridId, definition] of Object.entries(definitions)) {
    // Split into rows
    const rowStrings = definition.split('|');
    const rows: Cell[][] = [];

    for (let rowIdx = 0; rowIdx < rowStrings.length; rowIdx++) {
      const rowStr = rowStrings[rowIdx];
      // Split by single space to get individual cells
      // Multiple spaces = multiple empty cells
      const cellStrings = rowStr.split(' ');
      const cells: Cell[] = [];

      for (let colIdx = 0; colIdx < cellStrings.length; colIdx++) {
        const cellStr = cellStrings[colIdx];

        if (!cellStr) {
          // Empty string from split = Empty cell
          cells.push(Empty());
        } else if (cellStr === '_') {
          // Explicit empty marker
          cells.push(Empty());
        } else if (/^\d/.test(cellStr)) {
          // First char is digit = Concrete
          const concreteId = concreteIdFn
            ? concreteIdFn(cellStr, gridId, rowIdx, colIdx)
            : cellStr;
          cells.push(Concrete(concreteId));
        } else if (/^[a-zA-Z]/.test(cellStr)) {
          // First char is letter = Ref (auto-determined)
          cells.push(Ref(cellStr, null));
        } else if (cellStr.startsWith('*') && cellStr.length >= 2) {
          // *... = Primary ref (rest is grid_id)
          cells.push(Ref(cellStr.slice(1), true));
        } else if (cellStr.startsWith('~') && cellStr.length >= 2) {
          // ~... = Secondary ref (rest is grid_id)
          cells.push(Ref(cellStr.slice(1), false));
        } else {
          // Provide detailed error information
          const errorMsg =
            `Invalid cell string: '${cellStr}'\n` +
            `  Grid: '${gridId}'\n` +
            `  Row ${rowIdx}: "${rowStr}"\n` +
            `  Position: column ${colIdx}\n` +
            `  Valid formats:\n` +
            `    - Digit start (0-9...): Concrete cell (e.g., '1', '123abc')\n` +
            `    - Letter start (a-zA-Z...): Ref cell (e.g., 'A', 'Main')\n` +
            `    - '*' prefix: Primary ref (e.g., '*A', '*Main')\n` +
            `    - '~' prefix: Secondary ref (e.g., '~A', '~Main')\n` +
            `    - '_': Empty cell\n` +
            `    - Empty string (multiple spaces): Empty cell`;
          throw new Error(errorMsg);
        }
      }

      rows.push(cells);
    }

    // Validate all rows have same length
    if (rows.length > 0) {
      const cols = rows[0].length;
      const mismatched: [number, number][] = [];

      for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== cols) {
          mismatched.push([i, rows[i].length]);
        }
      }

      if (mismatched.length > 0) {
        let errorMsg =
          `Inconsistent row lengths in grid '${gridId}'\n` +
          `  Expected: ${cols} columns (from row 0)\n` +
          `  Mismatched rows:\n`;

        for (const [rowIdx, actualCols] of mismatched) {
          errorMsg += `    Row ${rowIdx}: ${actualCols} columns - "${rowStrings[rowIdx]}"\n`;
        }
        errorMsg += `  All rows must have the same number of cells`;
        throw new Error(errorMsg);
      }
    }

    // Create Grid
    const grid = createGrid(gridId, rows);
    store[gridId] = grid;
  }

  return Object.freeze(store);
}

/**
 * Export grid store to the compact string format (inverse of parseGrids).
 *
 * @param store - GridStore to export
 * @returns Object mapping grid_id to string definition
 *
 * @example
 * const store = parseGrids({
 *   "main": "1 A|2 3",
 *   "A": "4 5|6 7"
 * });
 * const exported = exportGrids(store);
 * // exported === { "main": "1 A|2 3", "A": "4 5|6 7" }
 */
export function exportGrids(store: GridStore): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [gridId, grid] of Object.entries(store)) {
    const rowStrings: string[] = [];

    for (let rowIdx = 0; rowIdx < grid.rows; rowIdx++) {
      const cellStrings: string[] = [];

      for (let colIdx = 0; colIdx < grid.cols; colIdx++) {
        const cell = grid.cells[rowIdx][colIdx];

        if (cell.type === 'empty') {
          // Empty cell - use underscore
          cellStrings.push('_');
        } else if (cell.type === 'concrete') {
          // Concrete cell - extract original value (before '@' if present)
          const originalValue = cell.id.split('@')[0];
          cellStrings.push(originalValue);
        } else if (cell.type === 'ref') {
          // Ref cell - prefix based on isPrimary status
          if (cell.isPrimary === true) {
            // Explicitly primary
            cellStrings.push('*' + cell.gridId);
          } else if (cell.isPrimary === false) {
            // Explicitly secondary
            cellStrings.push('~' + cell.gridId);
          } else {
            // Auto-determined (null)
            cellStrings.push(cell.gridId);
          }
        }
      }

      rowStrings.push(cellStrings.join(' '));
    }

    result[gridId] = rowStrings.join('|');
  }

  return result;
}
