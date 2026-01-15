/**
 * Tests for unique ID generation in parseGrids
 */

import { describe, it, expect } from 'vitest';
import { parseGrids, makeUniqueIdGenerator, getCoreId } from '../../src/lib/parser/parser.js';
import { Concrete, isConcrete } from '../../src/lib/core/types.js';
import type { TagFn } from '../../src/lib/tagging/types.js';

describe('TestGetCoreId', () => {
  it('test_get_core_id_without_suffix', () => {
    expect(getCoreId('1')).toBe('1');
    expect(getCoreId('2')).toBe('2');
    expect(getCoreId('9')).toBe('9');
    expect(getCoreId('123abc')).toBe('123abc');
  });

  it('test_get_core_id_with_unique_suffix', () => {
    expect(getCoreId('2@test:0:1')).toBe('2');
    expect(getCoreId('2@main:5:3')).toBe('2');
    expect(getCoreId('123abc@grid:10:20')).toBe('123abc');
  });
});

describe('TestUniqueIdGeneration', () => {
  it('test_unique_ids_for_non_special_cells', () => {
    // Create a tag function that marks '1' as player and '9' as stop
    const tagFn: TagFn = (cell) => {
      if (isConcrete(cell)) {
        const value = cell.id.split('@')[0];
        if (value === '1') return new Set(['player']);
        if (value === '9') return new Set(['stop']);
      }
      return new Set();
    };

    const idGenerator = makeUniqueIdGenerator(tagFn, new Set(['player', 'stop']));
    const definitions = {
      test: '1 2 9|2 9 2',
    };

    const store = parseGrids(definitions, idGenerator);
    const grid = store.test;

    // Cell [0][0] is '1' (player) - should keep original ID
    expect(isConcrete(grid.cells[0][0])).toBe(true);
    expect((grid.cells[0][0] as any).id).toBe('1');

    // Cell [0][1] is '2' - should get unique ID
    expect(isConcrete(grid.cells[0][1])).toBe(true);
    expect((grid.cells[0][1] as any).id).toBe('2@test:0:1');

    // Cell [0][2] is '9' (stop) - should keep original ID
    expect(isConcrete(grid.cells[0][2])).toBe(true);
    expect((grid.cells[0][2] as any).id).toBe('9');

    // Cell [1][0] is '2' - should get different unique ID than [0][1]
    expect(isConcrete(grid.cells[1][0])).toBe(true);
    expect((grid.cells[1][0] as any).id).toBe('2@test:1:0');

    // Cell [1][1] is '9' (stop) - should keep original ID (same as [0][2])
    expect(isConcrete(grid.cells[1][1])).toBe(true);
    expect((grid.cells[1][1] as any).id).toBe('9');

    // Cell [1][2] is '2' - should get yet another unique ID
    expect(isConcrete(grid.cells[1][2])).toBe(true);
    expect((grid.cells[1][2] as any).id).toBe('2@test:1:2');
  });

  it('test_without_id_generator_uses_original_ids', () => {
    const definitions = {
      test: '1 2 9|2 9 2',
    };

    // Parse without ID generator - all cells should keep original IDs
    const store = parseGrids(definitions);
    const grid = store.test;

    expect((grid.cells[0][0] as any).id).toBe('1');
    expect((grid.cells[0][1] as any).id).toBe('2');
    expect((grid.cells[0][2] as any).id).toBe('9');
    expect((grid.cells[1][0] as any).id).toBe('2');
    expect((grid.cells[1][1] as any).id).toBe('9');
    expect((grid.cells[1][2] as any).id).toBe('2');
  });

  it('test_multiple_player_warning', () => {
    const tagFn: TagFn = (cell) => {
      if (isConcrete(cell)) {
        const value = cell.id.split('@')[0];
        if (value === '1') return new Set(['player']);
      }
      return new Set();
    };

    // Capture console warnings
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    try {
      const idGenerator = makeUniqueIdGenerator(tagFn, new Set(['player']));
      const definitions = {
        test: '1 2 1|2 1 2',
      };

      parseGrids(definitions, idGenerator);

      // Should have warnings about multiple player cells
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Multiple player cells');
    } finally {
      console.warn = originalWarn;
    }
  });
});
