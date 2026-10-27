# 04 — Comprehensive File-by-File Technical Deep Dive

This document analyzes every important file in the project, explaining its exact internal code, rationale, exports, and relationships.

---

## 1. Frontend Client Files

### 1.1 `index.html`
- **Location**: `index.html`
- **Purpose**: Single-page application root HTML5 shell.
- **Why it exists**: Vite serves this file as the browser entry point.
- **Key Lines**:
  - Line 11: `<div id="app"></div>`: The target container for mounting the Svelte 5 application.
  - Line 12: `<script type="module" src="/src/main.js"></script>`: Native ES module entry point that Vite bundles.
- **Dependencies**: Loads `src/main.js` and `/favicon.svg`.
- **What happens if removed**: The frontend web server cannot render the application.

---

### 1.2 `vite.config.js`
- **Location**: `vite.config.js`
- **Purpose**: Bundler and development server configuration.
- **Why it exists**: Configures Vite with the Svelte 5 compiler plugin and Tailwind CSS v4 compiler.
- **Key Code**:
  ```javascript
  import { svelte } from '@sveltejs/vite-plugin-svelte'
  import tailwindcss from '@tailwindcss/vite'
  import { defineConfig } from 'vite'

  export default defineConfig({
    plugins: [
      tailwindcss(),
      svelte(),
    ],
  })
  ```
- **Technical Note**: Note that `@tailwindcss/vite` is Tailwind CSS v4's modern native Vite plugin, eliminating the need for `postcss.config.js` and `tailwind.config.js`.

---

### 1.3 `src/main.js`
- **Location**: `src/main.js`
- **Purpose**: Client-side application bootstrap script.
- **Why it exists**: Instantiates the root Svelte component and mounts it into the DOM.
- **Key Code**:
  ```javascript
  import { mount } from 'svelte'
  import './app.css'
  import App from './App.svelte'

  const app = mount(App, {
    target: document.getElementById('app'),
  })

  export default app
  ```
- **Svelte 5 Nuance**: Svelte 5 replaced `new App({ target })` with `mount(App, { target })`. This file reflects modern Svelte 5 best practices.

---

### 1.4 `src/App.svelte`
- **Location**: `src/App.svelte`
- **Purpose**: The primary application shell, layout container, and client-side tab router.
- **Why it exists**: Coordinates user navigation between the GraphQL Explorer and the Word Import workflow, monitors Strapi connectivity, and holds high-level state.
- **State Variables**:
  - `activeTab` (`'explorer' | 'import'`): Controls which feature view is rendered.
  - `connectionStatus` (`'idle' | 'loading' | 'connected' | 'error'`): Live Strapi connection state.
  - `responseTime` (`number`): Latency in milliseconds from the ping query.
  - `schemaFields` (`array`): Introspected query fields retrieved from Strapi.
  - `connectError` (`string | null`): Captured GraphQL or network error message.
- **Key Functions**:
  - `connect()`: Calls `pingStrapi()`, measures round-trip time with `performance.now()`, and if successful, calls `fetchStrapiSchema()` to load available collections.
  - `onMount(() => { connect() })`: Triggers auto-connection as soon as the page loads.
- **UI Structure**:
  - Sticky glassmorphic top navigation bar with tab switcher.
  - Hero header and configuration indicator card.
  - Two-column grid layout for Explorer mode (left: `ConnectionStatus`, guide, `SchemaExplorer`; right: `DataViewer`).
  - Full-width container for Import mode (`ImportPage`).

---

### 1.5 `src/app.css`
- **Location**: `src/app.css`
- **Purpose**: Global styling, Tailwind CSS v4 setup, and custom CSS design tokens.
- **Why it exists**: Implements a dark-mode glassmorphic theme with tailored gradients, micro-animations, and reusable utility classes.
- **Key Design Tokens**:
  - `--bg-primary: #0a0a0f`: Deep void background.
  - `--bg-card: #16161f`: Elevated card surface.
  - `--accent: #6366f1`: Indigo brand accent.
  - `--accent-light: #818cf8`: Soft indigo for labels and highlights.
  - `--success: #22c55e`, `--error: #ef4444`, `--warning: #f59e0b`.
- **Specialized Classes**:
  - `.grid-bg`: Ambient background grid.
  - `.glow-blob`: Blurred radial gradient backdrop.
  - `.glass-card`: Semi-transparent background with border and hover glow.
  - `.pulse-dot`: CSS-animated live status indicators (green, amber, red).

---

### 1.6 `src/lib/graphql.js`
- **Location**: `src/lib/graphql.js`
- **Purpose**: Base GraphQL HTTP transport client.
- **Why it exists**: Configures `GraphQLClient` from `graphql-request` with endpoint URLs, optional bearer tokens, and standardized error interception.
- **Key Exports**:
  - `client`: Instance of `GraphQLClient(GRAPHQL_URL, { headers })`.
  - `gqlQuery(query, variables = {})`: Asynchronous wrapper that executes requests and formats errors into `{ data, error }`.
- **Environment Handling**:
  - Reads `import.meta.env.VITE_STRAPI_GRAPHQL_URL` (defaults to `http://localhost:1337/graphql`).
  - Reads `import.meta.env.VITE_STRAPI_TOKEN` (omits header if blank for public role access).

---

### 1.7 `src/lib/strapiQueries.js`
- **Location**: `src/lib/strapiQueries.js`
- **Purpose**: Pre-packaged GraphQL queries and dynamic query constructor.
- **Why it exists**: Keeps GraphQL query strings isolated from UI components.
- **Key Functions**:
  1. `pingStrapi()`: Executes `query Ping { __typename }` to test connectivity with minimal payload.
  2. `fetchStrapiSchema()`: Runs `INTROSPECTION_QUERY` to fetch `__schema.queryType.fields` (names, types, descriptions).
  3. `fetchCollection(collectionName, fields = [])`: Dynamically generates and executes a query for any collection, automatically including `documentId` and preventing duplicate field requests.

---

### 1.8 `src/lib/ConnectionStatus.svelte`
- **Location**: `src/lib/ConnectionStatus.svelte`
- **Purpose**: Visual feedback widget for Strapi connection health.
- **Props**: `status`, `endpoint`, `responseTime`.
- **Behavior**: Displays a pulsing colored dot (green for connected, amber for loading, red for error), latency metrics in milliseconds, and protocol details.

---

### 1.9 `src/lib/SchemaExplorer.svelte`
- **Location**: `src/lib/SchemaExplorer.svelte`
- **Purpose**: Visual catalog of all queryable collections discovered via introspection.
- **Props**: `fields` (Array of GraphQL field objects).
- **Filtering Logic**: Automatically filters out internal Strapi internals:
  - Introspection fields (`__*`)
  - Upload plugin fields (`upload*`)
  - Internal i18n fields (`i18N*`)
  - User and review workflow internal types (`me`, `reviewWorkflows*`).
- **Visuals**: Badges fields by GraphQL kind (`OBJECT`, `LIST`, `SCALAR`) with distinct color codes.

---

### 1.10 `src/lib/DataViewer.svelte`
- **Location**: `src/lib/DataViewer.svelte`
- **Purpose**: Live query console allowing developers to test queries against any Strapi collection.
- **Props**: `disabled` (boolean, disabled if not connected).
- **Internal State**:
  - `collectionName`: Default `'articles'`.
  - `fieldsInput`: Comma-separated fields (e.g. `'Title, description, slug'`).
  - `result`: Parsed GraphQL response.
  - `error`: Error message string.
  - `queryStr`: Generated GraphQL query preview.
- **Key Methods**:
  - `runQuery()`: Parses input fields, calls `fetchCollection()`, calculates record counts, and updates both structured card views and formatted JSON blocks.

---

### 1.11 `src/lib/ImportPage.svelte`
- **Location**: `src/lib/ImportPage.svelte`
- **Purpose**: The complete user-facing workflow for the Word-to-Strapi automation system.
- **Steps**:
  1. `step = 'upload'`: Drag-and-drop file target with client-side validation (`.docx` extension check, 10MB size limit).
  2. `step = 'previewing'`: Displays field-by-field mapping results, word count, embedded image count, duplicate detection alert, missing field warnings, and ambiguity notices.
  3. `step = 'confirmed'`: Displays draft creation success, Strapi `documentId`, cover image media ID, verification status, and a direct link to Strapi Admin.
- **API Communication**:
  - Calls `POST http://localhost:3001/api/import/preview` with `multipart/form-data`.
  - Calls `POST http://localhost:3001/api/import/confirm` with `{ importId }`.
  - Sends `X-Import-Key: dev_local_key_123` header for service authentication.

---

## 2. Word-to-Strapi Microservice Files

### 2.1 `word-to-strapi-service/src/index.ts`
- **Location**: `word-to-strapi-service/src/index.ts`
- **Purpose**: Express HTTP server, endpoint routing, middleware orchestration, and process lifecycle.
- **Endpoints**:
  - `GET /health`: Returns service health and configuration flags (`geminiKeySet`, `strapiTokenSet`).
  - `POST /api/import/preview`: Accepts `.docx` upload, coordinates extraction, AI mapping, Zod validation, idempotency duplicate check, stores session, and returns preview.
  - `POST /api/import/confirm`: Receives `importId`, creates draft in Strapi, uploads cover image if present, re-fetches to verify data integrity, deletes session, and returns response.
- **Middleware**:
  - CORS middleware allowing `http://localhost:5173`.
  - `requireApiKey`: Validates `X-Import-Key` against `process.env.IMPORT_API_KEY`.
  - `multer`: Restricts uploads to `.docx` files up to 10MB stored in memory buffers.

---

### 2.2 `word-to-strapi-service/src/extract.ts`
- **Location**: `word-to-strapi-service/src/extract.ts`
- **Purpose**: Binary `.docx` parser and structural content extractor using Mammoth.
- **Key Functions**:
  - `extractDocx(buffer, filename)`: Converts `.docx` to HTML, intercepts inline images into memory buffers, parses 2-column tables into key-value pairs, parses headings (`h1`–`h6`), paragraphs, and lists.
  - `isImagePlaceholder(text)`: Detects pseudo-text like `[Optional cover photo]` and prevents treating it as a real image asset.
  - `isTemplateArtifact(text)`: Filters out template instructional text (e.g., `"Blog Content Entry Template"`, `"Sample values are provided..."`).
  - `normalizeKey(key)` & `normalizeValue(val)`: Cleans table keys (e.g. `"1. Title"` -> `"title"`) and converts `"Leave empty"` or `"N/A"` into `null`.

---

### 2.3 `word-to-strapi-service/src/mapper.ts`
- **Location**: `word-to-strapi-service/src/mapper.ts`
- **Purpose**: AI and rule-based content mapping engine.
- **Key Functions**:
  - `mapDocumentToArticle(doc, apiKey, modelName)`: Primary mapping entry point. If `apiKey` is provided, executes Google Gemini 1.5 Flash using structured output schemas. If `apiKey` is missing or fails, falls back gracefully to `ruleBasedMapping(doc)`.
  - `ruleBasedMapping(doc)`: Deterministic extraction using table key-value pairs and document structure.
  - `SYSTEM_PROMPT`: Rigorous prompt injection defenses instructing the LLM that document content is untrusted data and strictly forbidding hallucination or cross-field concatenation.

---

### 2.4 `word-to-strapi-service/src/schema.ts`
- **Location**: `word-to-strapi-service/src/schema.ts`
- **Purpose**: Zod schemas, data contracts, and payload builders.
- **Key Schemas**:
  - `StrapiArticlePayloadSchema`: Validates `Title` (max 255), `slug` (lowercase-hyphenated), `description` (max 1000), `content`.
  - `DocumentFieldsSchema`: Full mapping contract covering 18 potential independent fields.
  - `AI_OUTPUT_JSON_SCHEMA`: Native JSON schema passed to Gemini for structured generation.
- **Key Utilities**:
  - `slugify(title)`: Generates clean, URL-safe slugs.
  - `buildStrapiPayload(fields)`: Constructs the Strapi 5 draft payload conforming to `schema.json`.

---

### 2.5 `word-to-strapi-service/src/strapiClient.ts`
- **Location**: `word-to-strapi-service/src/strapiClient.ts`
- **Purpose**: Secure server-side HTTP client for Strapi 5 REST and Upload APIs.
- **Key Methods**:
  - `findByTitle(title)`: Queries Strapi for existing drafts with identical titles (`GET /api/articles?filters[Title][$eq]=...`).
  - `createDraft(payload)`: Posts draft entry (`POST /api/articles?status=draft`).
  - `uploadMedia(img, refId, field)`: Uploads image binary to `/api/upload` and attaches it directly to the article's `coverImage` attribute.
  - `getByDocumentId(documentId)`: Re-fetches the created article for verification.
  - `fetchWithRetry()`: Implements exponential backoff and timeout handling.

---

### 2.6 `word-to-strapi-service/src/importStore.ts`
- **Location**: `word-to-strapi-service/src/importStore.ts`
- **Purpose**: Ephemeral session memory store.
- **Why it exists**: Retains the parsed `.docx` payload, extracted images, and metadata between the `/preview` request and the `/confirm` request without requiring a temporary database.
- **TTL**: Sessions automatically expire after 30 minutes.

---

## 3. Strapi CMS Core Files

### 3.1 `my-strapi/config/plugins.ts`
- **Location**: `my-strapi/config/plugins.ts`
- **Purpose**: Strapi plugin configuration.
- **Key Configurations**:
  - `graphql`: Configures endpoint at `/graphql`, enables shadow CRUD, enables GraphQL playground, sets `depthLimit: 7` and `amountLimit: 100`.
  - `upload`: Specifies allowed media MIME types and denied executable MIME types.

---

### 3.2 `my-strapi/src/api/article/content-types/article/schema.json`
- **Location**: `my-strapi/src/api/article/content-types/article/schema.json`
- **Purpose**: Core Strapi Content Type schema definition for Articles.
- **Key Attributes**:
  - `Title` (`string`)
  - `description` (`text`)
  - `content` (`richtext`)
  - `date` (`date`)
  - `slug` (`uid`, targetField: `Title`)
  - `seo` (`component`, `seo.seo`)
  - `coverImage` (`media`, single image)
  - `Authordata` (`component`, `component.author-data`)
  - `contentNew` (`component`, `component.content-new`)
  - `button` (`component`, `component.button`)
  - `polldata` (`component`, `component.polldata`)
  - `Quizedata` (`component`, `component.quizedata`)
