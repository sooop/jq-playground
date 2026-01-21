# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

jq Playground is a web-based playground for testing and learning jq queries. It's built with vanilla JavaScript and Vite, using jq-web (WebAssembly) for query execution. The build produces a single self-contained HTML file via vite-plugin-singlefile.

## Development Commands

```bash
npm run dev      # Start dev server on localhost:3000 (auto-opens)
npm run build    # Build single-file production bundle to dist/
npm run preview  # Preview production build
```

## Architecture

### Component Communication Pattern

The app uses a factory function pattern where components return DOM elements with attached API objects:

```javascript
const component = createComponent();
// Access via: component.querySelector() or component.api.method()
```

**App.js** orchestrates all components and handles:
- Component initialization and layout assembly
- Event flow between components via callbacks
- Query execution with 500ms debounce
- Auto-play vs manual execution modes
- Panel resizing (horizontal between input/query, vertical between top/output)

### Core Execution Flow

1. User types in input (JSON) or query (jq filter)
2. `App.executeQuery()` debounces and checks auto-play state
3. `jqEngine.execute()` calls jq-web WebAssembly module
4. Result flows to `outputPanel.api.showResult()` with format selection (JSON/CSV table)
5. Query is added to history via `Storage` (debounced localStorage writes)

### jq Engine Initialization

The jq-web library is loaded from CDN in `index.html`. Engine initialization handles two API versions:
- v0.5.x: `window.jq.promised`
- v0.6.x: `window.jq` itself is a Promise

Empty jq results throw "Unexpected end of JSON input" - this is caught and converted to `[]`.

### Storage System

`Storage` class (src/utils/storage.js) provides debounced localStorage writes:
- Immediate in-memory updates via `pendingSaves` cache
- 500ms debounced persistence to localStorage
- `flushAll()` called on beforeunload to ensure data persistence

Keys: `jq-history`, `jq-saved-queries`

### CSV Conversion

`csv-converter.js` handles JSON → HTML table and CSV export:
- Flattens nested objects (max depth 10) with `_` separator
- Arrays/deep objects become JSON strings
- Tables limited to 1000 rows with warning message
- Only processes data that will be displayed (performance optimization)

### File Handling

`file-handler.js` supports drag & drop and file input with validation:
- Max file size: 5MB
- Accepts: `.json`, `.txt`, or any text file
- Validates JSON structure and provides error messages

## Key Behavioral Notes

### Auto-Play Toggle
- Keyboard shortcut: `Ctrl+Shift+E`
- When disabled, queries don't auto-execute
- Format changes force execution even when paused
- Manual execute button (`manualExecute()`) runs once without changing state

### Query Panel Features
- History dropdown (max 20 items, FIFO when full)
- Saved queries (persistent, user-named)
- Tab key support in textareas (implemented in each panel component)
- Autocomplete for jq functions (`jq-functions.js` provides function list with input type hints)

### Cheatsheet
- Collapsible panel with common jq examples
- Click on example to append to query (with `|` pipe if query exists)

### Panel Resizing
Mouse-drag resizers with 20-80% bounds, implemented via grid template manipulation.

## Common Issues

**"displayRows is not defined"**: In csv-converter.js, ensure `rows` variable is used in forEach loops, not undefined `displayRows`.

**jq initialization failures**: Check CDN availability and version compatibility in jq-engine.js init logic.

**Storage not persisting**: Ensure `Storage.flushAll()` is called on beforeunload, and localStorage quota hasn't been exceeded.
