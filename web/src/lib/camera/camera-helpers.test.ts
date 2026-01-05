/**
 * Tests for camera helpers (hierarchy and scale).
 */

import { describe, it, expect } from 'vitest';
import {
  getParent,
  getDirectlyContainedReferences,
  findDirectlyContainedReference,
  getPathToAncestor,
  getAncestorChain,
  getScaleAndOffset,
} from './index.js';
import { parseGrids } from '../parser/parser.js';

describe('Hierarchy Helper', () => {
  describe('getParent', () => {
    it('returns null for root grid (no parent)', () => {
      const store = parseGrids({
        root: '1 2',
      });

      expect(getParent(store, 'root')).toBe(null);
    });

    it('returns parent grid ID for child grid', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });

      expect(getParent(store, 'child')).toBe('root');
    });

    it('handles multiple levels of nesting', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: '1 2',
      });

      expect(getParent(store, 'b')).toBe('a');
      expect(getParent(store, 'a')).toBe('root');
      expect(getParent(store, 'root')).toBe(null);
    });
  });

  describe('getDirectlyContainedReferences', () => {
    it('returns empty array for grid with no references', () => {
      const store = parseGrids({
        main: '1 2|3 4',
      });

      expect(getDirectlyContainedReferences(store, 'main')).toEqual([]);
    });

    it('returns single reference', () => {
      const store = parseGrids({
        main: 'child _',
        child: '1 2',
      });

      expect(getDirectlyContainedReferences(store, 'main')).toEqual(['child']);
    });

    it('returns multiple unique references in order', () => {
      const store = parseGrids({
        main: 'a b|c _',
        a: '1 2',
        b: '3 4',
        c: '5 6',
      });

      expect(getDirectlyContainedReferences(store, 'main')).toEqual(['a', 'b', 'c']);
    });

    it('deduplicates repeated references', () => {
      const store = parseGrids({
        main: 'a b a',
        a: '1 2',
        b: '3 4',
      });

      // 'a' appears twice but should only be listed once
      expect(getDirectlyContainedReferences(store, 'main')).toEqual(['a', 'b']);
    });

    it('returns empty array for non-existent grid', () => {
      const store = parseGrids({
        main: '1 2',
      });

      expect(getDirectlyContainedReferences(store, 'nonexistent')).toEqual([]);
    });
  });

  describe('findDirectlyContainedReference', () => {
    it('returns true when reference exists', () => {
      const store = parseGrids({
        parent: 'child _',
        child: '1 2',
      });

      expect(findDirectlyContainedReference(store, 'parent', 'child')).toBe(true);
    });

    it('returns false when reference does not exist', () => {
      const store = parseGrids({
        parent: '1 2',
        child: '3 4',
      });

      expect(findDirectlyContainedReference(store, 'parent', 'child')).toBe(false);
    });
  });

  describe('getPathToAncestor', () => {
    it('returns path for simple parent-child relationship', () => {
      const store = parseGrids({
        root: 'child _',
        child: '1 2',
      });

      expect(getPathToAncestor(store, 'child', 'root')).toEqual(['child', 'root']);
    });

    it('returns path through multiple levels', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: 'c _',
        c: '1 2',
      });

      expect(getPathToAncestor(store, 'c', 'root')).toEqual(['c', 'b', 'a', 'root']);
      expect(getPathToAncestor(store, 'c', 'a')).toEqual(['c', 'b', 'a']);
      expect(getPathToAncestor(store, 'b', 'root')).toEqual(['b', 'a', 'root']);
    });

    it('returns single-element path when grid is its own ancestor', () => {
      const store = parseGrids({
        root: '1 2',
      });

      expect(getPathToAncestor(store, 'root', 'root')).toEqual(['root']);
    });

    it('returns null when target is not an ancestor', () => {
      const store = parseGrids({
        root: 'a b',
        a: '1 2',
        b: '3 4',
      });

      // 'b' is not an ancestor of 'a'
      expect(getPathToAncestor(store, 'a', 'b')).toBe(null);
    });

    it('returns null when cycle is detected', () => {
      const store = parseGrids({
        a: 'b _',
        b: 'a _',
      });

      // Cycle: a->b->a, can't reach a non-existent ancestor
      expect(getPathToAncestor(store, 'a', 'nonexistent')).toBe(null);
    });
  });

  describe('getAncestorChain', () => {
    it('returns single element for root grid', () => {
      const store = parseGrids({
        root: '1 2',
      });

      expect(getAncestorChain(store, 'root')).toEqual(['root']);
    });

    it('returns full chain to root', () => {
      const store = parseGrids({
        root: 'a _',
        a: 'b _',
        b: '1 2',
      });

      expect(getAncestorChain(store, 'b')).toEqual(['b', 'a', 'root']);
    });

    it('returns null when cycle is detected', () => {
      const store = parseGrids({
        a: 'b _',
        b: 'a _',
      });

      expect(getAncestorChain(store, 'a')).toBe(null);
    });
  });
});

describe('Scale Helper', () => {
  describe('getScaleAndOffset', () => {
    it('handles single grid (root)', () => {
      const store = parseGrids({
        root: '1 2|3 4', // 2x2 grid
      });

      const result = getScaleAndOffset(store, ['root']);

      expect(result).not.toBe(null);
      if (!result) return;

      // Width and height should be grid dimensions
      expect(result.width).toBe(2);
      expect(result.height).toBe(2);

      // Center should be at (1, 1) for a 2x2 grid
      expect(result.centerX).toBe(1);
      expect(result.centerY).toBe(1);
    });

    it('handles 3x3 root grid', () => {
      const store = parseGrids({
        root: '1 2 3|4 5 6|7 8 9',
      });

      const result = getScaleAndOffset(store, ['root']);

      expect(result).not.toBe(null);
      if (!result) return;

      expect(result.width).toBe(3);
      expect(result.height).toBe(3);
      expect(result.centerX).toBe(1.5);
      expect(result.centerY).toBe(1.5);
    });

    it('calculates scale for nested grid', () => {
      const store = parseGrids({
        root: 'child _|_ _', // 2x2 grid, child at (0, 0)
        child: '1 2', // 1x2 grid
      });

      const result = getScaleAndOffset(store, ['root', 'child']);

      expect(result).not.toBe(null);
      if (!result) return;

      // Child occupies one cell of the 2x2 root, so width/height are each 1
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);

      // Child is at position (0, 0), so its center is at (0.5, 0.5)
      expect(result.centerX).toBe(0.5);
      expect(result.centerY).toBe(0.5);
    });

    it('calculates scale for grid in different positions', () => {
      const store = parseGrids({
        root: '_ child|_ _', // 2x2 grid, child at (0, 1)
        child: '1 2',
      });

      const result = getScaleAndOffset(store, ['root', 'child']);

      expect(result).not.toBe(null);
      if (!result) return;

      // Width and height are still 1 (one cell)
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);

      // Child is at position (0, 1), so its center is at (1.5, 0.5)
      expect(result.centerX).toBe(1.5);
      expect(result.centerY).toBe(0.5);
    });

    it('handles deeply nested grids', () => {
      const store = parseGrids({
        root: 'a _', // 1x2
        a: 'b _',    // 1x2
        b: '1 2',    // 1x2
      });

      const result = getScaleAndOffset(store, ['root', 'a', 'b']);

      expect(result).not.toBe(null);
      if (!result) return;

      // Root is 1x2, so each cell has width 1 and height 1
      // 'a' occupies position (0, 0) with width 1, height 1
      // 'a' is 1x2, so each of its cells has width 1/2, height 1
      // 'b' occupies position (0, 0) in 'a' with width 1/2, height 1

      expect(result.width).toBe(0.5);
      expect(result.height).toBe(1);

      // 'b' is at (0, 0) in 'a', and 'a' is centered at (0.5, 0.5)
      // So 'b' center is at (0.25, 0.5)
      expect(result.centerX).toBe(0.25);
      expect(result.centerY).toBe(0.5);
    });

    it('returns null for empty path', () => {
      const store = parseGrids({
        root: '1 2',
      });

      expect(getScaleAndOffset(store, [])).toBe(null);
    });

    it('returns null for invalid path (child not referenced)', () => {
      const store = parseGrids({
        root: '1 2',
        orphan: '3 4',
      });

      expect(getScaleAndOffset(store, ['root', 'orphan'])).toBe(null);
    });

    it('returns null for non-existent grid', () => {
      const store = parseGrids({
        root: '1 2',
      });

      expect(getScaleAndOffset(store, ['nonexistent'])).toBe(null);
    });
  });
});
