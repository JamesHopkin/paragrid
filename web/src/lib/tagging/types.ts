/**
 * Tagging system types for marking cells with metadata.
 */

import type { Cell } from '../core/types.js';

/**
 * Function that returns tags for a given cell.
 * Tags are arbitrary strings that can be used to mark cells with metadata.
 * For example, a "stop" tag can prevent a cell from being pushed.
 */
export type TagFn = (cell: Cell) => Set<string>;
