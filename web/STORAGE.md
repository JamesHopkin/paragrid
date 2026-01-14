# Paragrid Editor Storage System

The Paragrid Level Editor now supports both **localStorage** (for standalone use) and **server-based** storage (for development with hot-reload).

## Storage Modes

### 1. LocalStorage Mode (Standalone)

**Benefits:**
- Works completely offline - no server required
- Real-time cross-tab synchronization when you save
- Data persists in browser's localStorage (5-10MB capacity)
- Perfect for quick prototyping and local editing
- Manual save only (prevents broken intermediate states)

**How to Use:**

The editor automatically uses localStorage when:
- Built with `BUILD_TARGET=editor` (standalone build)
- No dev server is detected (automatic fallback)
- URL parameter `?standalone` is present

**Cross-Tab Synchronization:**
- Open the same editor in multiple tabs of the **same browser**
- When you save in one tab, changes instantly appear in other tabs
- Uses browser's native `storage` event (no polling needed)
- **Note:** Different browsers (e.g., Chrome vs Firefox) have separate storage

**Build Standalone Version:**
```bash
npm run build:editor
```

This creates `dist/editor.html` - a single-file HTML that can be:
- Opened directly in any browser (just double-click)
- Hosted on any static file server
- Shared as a single file

### 2. Server Mode (Development)

**Benefits:**
- Save to actual files on disk
- Share state across different browsers/machines
- Integrate with Python visualization pipeline
- Can export to parseable format files

**How to Use:**

The editor automatically uses server storage when:
- Running with `npm run dev` (Vite dev server)
- Server API is available at `/api/grids`

Server mode does NOT have auto-save - you must click the "Save" button manually.

## Implementation Details

### Storage Abstraction

The system uses a `StorageAdapter` interface with two implementations:

**LocalStorageAdapter:**
- Saves editor state as JSON in `localStorage.getItem('paragrid-editor-state')`
- Tracks version number for change detection
- Implements cross-tab sync via `window.addEventListener('storage', ...)`

**ServerStorageAdapter:**
- POSTs grid data to `/api/grids`
- GETs grid data from `/api/grids`
- Converts between editor format and server's parseable format

### Save Behavior

**Both modes use manual save:**
- Must click "Save" button or press Ctrl/Cmd+S to persist changes
- Prevents saving broken intermediate states that could break simulation
- "Save" button is disabled when there are no unsaved changes
- Undo/redo history is independent of save state

**Why no auto-save?**
- Grid layouts must be valid before saving
- Intermediate states during editing may have conflicts or incomplete references
- Manual save gives you control over what gets persisted

### Cross-Tab Sync Details

The `storage` event fires in **other tabs only** when localStorage changes:

```typescript
window.addEventListener('storage', (event) => {
  if (event.key === 'paragrid-editor-state' && event.newValue) {
    // Parse new state and update UI
    const newState = JSON.parse(event.newValue);
    updateEditorState(newState);
  }
});
```

**Important:** The tab that made the change does NOT receive the event - it already has the updated state.

### State Format

LocalStorage stores the complete editor state as JSON:

```json
{
  "grids": {
    "grid_1": {
      "id": "grid_1",
      "rows": 5,
      "cols": 5,
      "cells": [[...], ...]
    }
  },
  "gridOrder": ["grid_1"],
  "nextGridId": 2,
  "metadata": {
    "grid_1": { "scale": 1.0 }
  }
}
```

## Build Configuration

### Vite Config

The `vite.config.ts` now supports three build targets:

```typescript
// index.html (default)
npm run build:index

// demo-iso.html (isometric demo)
npm run build:demo

// editor.html (standalone editor with localStorage)
npm run build:editor
```

The `BUILD_TARGET=editor` build:
- Injects `__PARAGRID_STANDALONE__ = true` as a compile-time constant
- Forces localStorage mode
- Enables cross-tab sync
- Creates single-file HTML with all assets inlined

### Full Build

```bash
npm run build
```

This runs all three builds:
- `dist/index.html` - Main visualization (uses server if available)
- `dist/demo-iso.html` - Isometric demo (uses server if available)
- `dist/editor.html` - Standalone editor (localStorage only)

## Testing Cross-Tab Sync

1. Build the standalone editor:
   ```bash
   npm run build:editor
   ```

2. Open `dist/editor.html` in a browser tab

3. Open the same file in a second tab (or duplicate the tab)

4. Make changes in one tab (add grid, edit cells, etc.)

5. Click "Save" in the first tab

6. Watch the other tab update instantly with the saved changes

**Note:** This only works within the same browser. Different browsers (Chrome vs Firefox) have separate localStorage.

## Storage Capacity

**LocalStorage limits:**
- Typically 5-10MB per domain
- Varies by browser
- Shared across all tabs/windows of same origin
- Survives browser restart

**Typical editor state size:**
- Small project (5 grids, 5×5 each): ~5-10 KB
- Medium project (20 grids, mixed sizes): ~50-100 KB
- Large project (100 grids): ~500 KB - 1 MB

You're unlikely to hit the limit for typical Paragrid projects.

## Browser Compatibility

The localStorage implementation uses standard web APIs:

- `localStorage.getItem/setItem` - All modern browsers
- `storage` event - All modern browsers
- `JSON.parse/stringify` - All modern browsers
- `AbortSignal.timeout` - Chrome 103+, Firefox 100+, Safari 15.4+

For maximum compatibility, the dev server fallback works in any browser.

## Troubleshooting

### Changes not syncing across tabs?

- Ensure both tabs are loading the **same file** (check URL/path)
- Ensure you're using the **same browser** (different browsers = different storage)
- Check browser console for errors
- Clear localStorage and reload: `localStorage.clear()`

### Lost data after closing browser?

- This should NOT happen - localStorage persists across sessions
- Check if browser is in "incognito/private" mode (localStorage is cleared on exit)
- Check browser settings - ensure it's not clearing data on exit

### Build failing?

- Ensure TypeScript compilation succeeds: `npm run tsc`
- Check that all imports are correct
- Verify `__PARAGRID_STANDALONE__` is properly declared in `global.d.ts`

## Future Enhancements

Possible additions:

1. **Export/Import:** Download state as JSON file, reload from file
2. **Cloud Sync:** Sync localStorage across devices via cloud service
3. **Conflict Resolution:** Handle simultaneous edits in multiple tabs more gracefully
4. **Compression:** Store state in compressed format to save space
5. **Auto-backup:** Periodic snapshots to IndexedDB for recovery
