/**
 * Tests for push transition metadata.
 */

import { describe, test, expect } from 'vitest';
import { Direction } from '../../src/lib/core/direction.js';
import { parseGrids } from '../../src/lib/parser/parser.js';
import { push } from '../../src/lib/operations/push.js';
import { RefStrategyType, type RuleSet } from '../../src/lib/operations/rules.js';
import { CellPosition } from '../../src/lib/core/position.js';

/**
 * Helper to parse compact grid format with grid IDs on each line.
 * Format: "A: 1 2 3\nB: 4 5"
 */
function parseCompact(input: string) {
  const lines = input.split('\n').filter(l => l.trim());
  const defs: Record<string, string> = {};
  for (const line of lines) {
    const [gridId, ...rest] = line.split(':');
    defs[gridId.trim()] = rest.join(':').trim();
  }
  return parseGrids(defs);
}

const solidRules: RuleSet = {
  refStrategy: [RefStrategyType.SOLID, RefStrategyType.PORTAL, RefStrategyType.SWALLOW],
  primaryRefRule: 'first',
  entryRule: 'far',
};

describe('Push transition metadata', () => {
  test('simple move within grid has move transitions', () => {
    const input = `
A: 1 2 3 _
    `.trim();
    const store = parseCompact(input);

    const result = push(store, new CellPosition('A', 0, 0), Direction.E, solidRules);
    if ('reason' in result) {
      throw new Error(`Expected success, got ${result.reason}`);
    }

    expect(result.chain).toHaveLength(4);
    expect(result.chain[0].transition).toBe(null); // Initial position
    expect(result.chain[1].transition).toBe('move'); // Move to col 1
    expect(result.chain[2].transition).toBe('move'); // Move to col 2
    expect(result.chain[3].transition).toBe('move'); // Move to col 3 (empty)
  });

  test('enter transition when entering a ref', () => {
    const input = `
A: 1 B
B: 2 _
    `.trim();
    const store = parseCompact(input);

    const portalRules: RuleSet = {
      refStrategy: [RefStrategyType.PORTAL, RefStrategyType.SOLID, RefStrategyType.SWALLOW],
      primaryRefRule: 'first',
      entryRule: 'far',
    };

    const result = push(store, new CellPosition('A', 0, 0), Direction.E, portalRules);
    if ('reason' in result) {
      throw new Error(`Expected success, got ${result.reason}`);
    }

    // PORTAL enters the ref directly without including the ref cell in path
    expect(result.chain).toHaveLength(3);
    expect(result.chain[0].transition).toBe(null); // Initial position (cell with 1)
    expect(result.chain[1].transition).toBe('enter'); // Enter into B at cell with 2
    expect(result.chain[2].transition).toBe('move'); // Move to empty in B
  });

  test('exit transition when exiting from nested grid', () => {
    const input = `
A: 1 B 3
B: 2 _
    `.trim();
    const store = parseCompact(input);

    const result = push(store, new CellPosition('A', 0, 0), Direction.E, solidRules);
    if ('reason' in result) {
      throw new Error(`Expected success, got ${result.reason}`);
    }

    // SOLID treats B as solid cell, pushes through it, but ultimately finds empty in B
    expect(result.chain).toHaveLength(4);
    expect(result.chain[0].transition).toBe(null); // Initial position (A cell with 1)
    expect(result.chain[1].transition).toBe('move'); // Move to ref B in A
    expect(result.chain[2].transition).toBe('move'); // Move to cell with 3 in A
    expect(result.chain[3].transition).toBe('enter'); // Enter B to find empty
  });

  test('exit transition when cascading out of nested grid', () => {
    const input = `
A: 1 B 3
B: 2
    `.trim();
    const store = parseCompact(input);

    const result = push(store, new CellPosition('A', 0, 0), Direction.E, solidRules);
    if ('reason' in result) {
      throw new Error(`Expected success, got ${result.reason}`);
    }

    // SOLID pushes through ref B, enters it, then exits back out (cascading)
    expect(result.chain).toHaveLength(5);
    expect(result.chain[0].transition).toBe(null); // Initial (A cell with 1)
    expect(result.chain[1].transition).toBe('move'); // Move to ref B
    expect(result.chain[2].transition).toBe('move'); // Move to cell with 3
    expect(result.chain[3].transition).toBe('enter'); // Enter B (cell with 2)
    expect(result.chain[4].transition).toBe('exit'); // Exit B back to A (cycles to start)
  });

  test('cycle back to start', () => {
    const input = `
A: 1 A
    `.trim();
    const store = parseCompact(input);

    const portalRules: RuleSet = {
      refStrategy: [RefStrategyType.PORTAL, RefStrategyType.SOLID, RefStrategyType.SWALLOW],
      primaryRefRule: 'first',
      entryRule: 'far',
    };

    const result = push(store, new CellPosition('A', 0, 0), Direction.E, portalRules);
    if ('reason' in result) {
      throw new Error(`Expected success, got ${result.reason}`);
    }

    // Start at A[0,0], enter A (portal), cycles back to start
    expect(result.chain).toHaveLength(2);
    expect(result.chain[0].transition).toBe(null); // Initial position
    expect(result.chain[1].transition).toBe('enter'); // Enter (cycles back to start)
  });
});
