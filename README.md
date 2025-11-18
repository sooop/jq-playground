# jq Playground

A modern web-based playground for testing and learning jq queries with a clean, modular architecture.

## Features

- Real-time jq query execution
- JSON and CSV output formats
- Drag & drop file support
- Query history and saved queries
- Syntax cheatsheet
- Tab key support in editors

## Project Structure

```
jq-playground/
├── src/
│   ├── components/      # UI components
│   │   ├── Header.js
│   │   ├── InputPanel.js
│   │   ├── QueryPanel.js
│   │   ├── OutputPanel.js
│   │   └── Modal.js
│   ├── core/           # Core logic
│   │   ├── jq-engine.js
│   │   ├── csv-converter.js
│   │   └── file-handler.js
│   ├── utils/          # Utilities
│   │   └── storage.js
│   ├── styles/         # CSS modules
│   │   ├── layout.css
│   │   ├── components.css
│   │   └── main.css
│   ├── App.js
│   └── main.js
├── index.html
├── vite.config.js
└── package.json
```

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Tech Stack

- **Build Tool**: Vite
- **jq Engine**: jq-web (WebAssembly)
- **Architecture**: Vanilla JS with modular components

## Legacy

The original single-file implementation is available as `jq-playground.html` for reference.
