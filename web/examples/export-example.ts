/**
 * Example demonstrating the exportGrids function.
 *
 * This shows how to:
 * 1. Parse grids from string format
 * 2. Modify the grid store (via game operations)
 * 3. Export the current state back to string format
 * 4. Use the exported format to recreate the same grid store
 */

import { parseGrids, exportGrids } from '../src/lib/parser/parser.js';

// Example 1: Simple round-trip
console.log('=== Example 1: Simple Round-Trip ===\n');

const original = {
  main: '1 2|3 4',
  inner: '5 6|7 8',
};

console.log('Original definitions:');
console.log(original);

const store = parseGrids(original);
const exported = exportGrids(store);

console.log('\nExported definitions:');
console.log(exported);

console.log('\nAre they equal?', JSON.stringify(original) === JSON.stringify(exported));

// Example 2: Complex grid with references
console.log('\n\n=== Example 2: Complex Grid with References ===\n');

const complex = {
  main: '9 9 9 9 9|9 _ 1 _ 9|9 _ *inner _ 9|9 ~inner _ 2 9|9 9 9 9 9',
  inner: '_ a _|a _ a|_ a _',
  a: '3 4|5 6',
};

console.log('Complex definitions:');
console.log(complex);

const complexStore = parseGrids(complex);
const complexExported = exportGrids(complexStore);

console.log('\nExported:');
console.log(complexExported);

// Example 3: Using exported format in code
console.log('\n\n=== Example 3: Using Exported Format ===\n');

const gameState = parseGrids({
  level1: '1 _ 2|_ goal _|3 _ 4',
});

console.log('Game state after some operations...');
// ... game operations would happen here ...

// Export current state
const savedState = exportGrids(gameState);
console.log('Saved state:', savedState);

// Later, restore from saved state
const restoredState = parseGrids(savedState);
console.log('Restored successfully:', Object.keys(restoredState).length, 'grids');
