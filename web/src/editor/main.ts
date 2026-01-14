/// <reference path="./global.d.ts" />
/**
 * Main entry point for the Paragrid Level Editor
 */

import { onStateChange, initializeStorage, loadFromStorage, getState } from './state.js';
import { renderGrids, initializeUI, updateHistoryStatus, selectCellByCoords } from './ui.js';
import { createStorageAdapter, LocalStorageAdapter } from './storage.js';

// Check if we should force localStorage mode (set via build config or URL parameter)
const urlParams = new URLSearchParams(window.location.search);
const forceLocalStorage = urlParams.has('standalone') ||
                         (typeof __PARAGRID_STANDALONE__ !== 'undefined' && __PARAGRID_STANDALONE__ === true);

/**
 * Initialize the editor
 */
async function init(): Promise<void> {
  // Create and initialize storage adapter
  console.log('🔧 Initializing storage...');
  const adapter = await createStorageAdapter(forceLocalStorage);
  initializeStorage(adapter);

  // Try to load current state from storage
  console.log('🔄 Loading current state...');
  const result = await loadFromStorage();

  if (result.success) {
    if (result.version !== undefined) {
      console.log(`✅ Loaded state (version ${result.version})`);
    } else {
      console.log('✅ Loaded state');
    }
  } else {
    console.log('📦 No saved state found, using default');
  }

  // Set up state change listener to re-render and update history
  onStateChange(() => {
    renderGrids();
    updateHistoryStatus();
  });

  // Initialize UI event listeners
  initializeUI();

  // Initial render
  renderGrids();

  // Select first cell (0, 0) of first grid if it exists
  const state = getState();
  const firstGridId = state.gridOrder[0];
  if (firstGridId) {
    selectCellByCoords(firstGridId, 0, 0);
  }

  console.log('🚀 Paragrid Level Editor initialized');

  if (adapter instanceof LocalStorageAdapter) {
    console.log('💾 Using localStorage - click Save button to persist changes');
    console.log('🔄 Multi-tab sync enabled - saved changes will sync across browser tabs');
  } else {
    console.log('💾 Using server storage - click Save button to persist changes');
  }
}

// Start the editor when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
