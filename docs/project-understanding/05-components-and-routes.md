# 05 — Components, Routing, and UI Architecture

## 1. Routing and Navigation Architecture

### Verification: SPA State Routing vs File-Based Routing
The application is a client-side Single Page Application (SPA). It does not use file-based routing frameworks (such as SvelteKit's `+page.svelte`). Instead, routing is managed via top-level reactive tab state in `src/App.svelte`:

```javascript
let activeTab = 'explorer' // 'explorer' | 'import'
```

### Route / View Breakdown

| View / Tab | State Key | Main Component | URL Representation | Primary Purpose |
|---|---|---|---|---|
| **GraphQL Explorer** | `activeTab = 'explorer'` | `App.svelte` (inlined layout) | `http://localhost:5173` | Test Strapi connectivity, introspect available query fields, and execute live GraphQL queries against any collection. |
| **Word Import Studio** | `activeTab = 'import'` | `ImportPage.svelte` | `http://localhost:5173` (Tab 2) | Upload Microsoft Word documents, preview AI/rule-based field mappings, inspect warnings/duplicates, and create draft entries in Strapi. |

---

## 2. Complete Frontend Component Inventory

### Component 1: `App.svelte`
- **File**: `src/App.svelte`
- **Role**: Application shell, layout provider, top navigation, and global connection monitor.
- **Props**: None (Root component).
- **Internal State**:
  - `activeTab`: String (`'explorer' | 'import'`).
  - `connectionStatus`: String (`'idle' | 'loading' | 'connected' | 'error'`).
  - `responseTime`: Number or null (latency in ms).
  - `schemaFields`: Array of GraphQL query field objects.
  - `connectError`: String or null.
- **Children**: `ConnectionStatus`, `SchemaExplorer`, `DataViewer`, `ImportPage`.
- **Styling**: Tailwind utility classes + Custom tokens (`.grid-bg`, `.glow-blob`, `.glass-card`).

---

### Component 2: `ConnectionStatus.svelte`
- **File**: `src/lib/ConnectionStatus.svelte`
- **Role**: Visual connection indicator and response time metric card.
- **Props**:
  - `status`: `'idle' | 'loading' | 'connected' | 'error'` (default: `'idle'`).
  - `endpoint`: String (GraphQL URL).
  - `responseTime`: Number or null (latency in ms).
- **Interactions**: Reactive styling that changes color badges and triggers pulsing status dots (`.pulse-dot.green`, `.amber`, `.red`).
- **Parent**: `App.svelte`.

---

### Component 3: `SchemaExplorer.svelte`
- **File**: `src/lib/SchemaExplorer.svelte`
- **Role**: Introspection viewer displaying discovered Strapi collections and types.
- **Props**:
  - `fields`: Array of introspected query field objects (`{ name, description, type }`).
- **Internal Logic**:
  - Filters out internal Strapi attributes (`__*`, `upload*`, `i18N*`, `me`, `reviewWorkflows*`).
  - Dynamically assigns color-coded badges based on GraphQL `type.kind` (`OBJECT`, `LIST`, `SCALAR`).
- **Parent**: `App.svelte`.

---

### Component 4: `DataViewer.svelte`
- **File**: `src/lib/DataViewer.svelte`
- **Role**: Interactive live GraphQL query console.
- **Props**:
  - `disabled`: Boolean (disabled when Strapi is not connected).
- **Internal State**:
  - `collectionName`: String (e.g. `'articles'`).
  - `fieldsInput`: String (e.g. `'Title, description, slug'`).
  - `loading`: Boolean.
  - `result`: Object or null.
  - `error`: String or null.
  - `queryStr`: Generated GraphQL query preview string.
- **Methods**:
  - `runQuery()`: Parses input fields, calls `fetchCollection()` from `strapiQueries.js`, and sets `result` or `error`.
  - Preset button: "Load Articles" immediately sets collection to `articles` and queries `Title`.
- **Parent**: `App.svelte`.

---

### Component 5: `ImportPage.svelte`
- **File**: `src/lib/ImportPage.svelte`
- **Role**: End-to-end Word document import wizard.
- **Props**: None.
- **State Machine**:
  - `step`: `'upload' | 'previewing' | 'confirmed' | 'error'`.
  - `file`: File object or null.
  - `isDragOver`: Boolean (for drag highlight styles).
  - `isLoading`: Boolean.
  - `preview`: Extracted payload, missing fields, ambiguities, confidence, and duplicate flags.
  - `result`: Strapi `documentId`, media upload ID, and verification diff report.
- **Network Actions**:
  - `uploadAndPreview()`: Calls `POST /api/import/preview`.
  - `confirmImport()`: Calls `POST /api/import/confirm`.
  - `cancel()`: Resets wizard state back to `'upload'`.
- **Parent**: `App.svelte`.

---

### Component 6: `Counter.svelte`
- **File**: `src/lib/Counter.svelte`
- **Role**: Starter demo counter component illustrating Svelte 5 Runes.
- **State**: `let count = $state(0)`.
- **Event**: `onclick={() => count++}`.
- **Status**: Optional / Starter template component (currently unrendered in `App.svelte`).

---

## 3. Component Communication Patterns

```
           App.svelte (State Hub)
           ├── [Prop: status, endpoint, responseTime] ──► ConnectionStatus.svelte
           ├── [Prop: fields] ────────────────────────► SchemaExplorer.svelte
           ├── [Prop: disabled] ──────────────────────► DataViewer.svelte
           └── [Tab Switch] ──────────────────────────► ImportPage.svelte
                                                             │
                                                  (HTTP Fetch to :3001)
                                                             │
                                                             ▼
                                                  word-to-strapi-service
```

1. **Props Down**: `App.svelte` queries connection and schema data via `strapiQueries.js` and passes results down to `ConnectionStatus` and `SchemaExplorer` via standard Svelte props (`export let ...`).
2. **Independent Microservice Calls**: `ImportPage.svelte` manages its own asynchronous HTTP lifecycle with the backend automation service at `http://localhost:3001`, remaining completely isolated from GraphQL logic.
