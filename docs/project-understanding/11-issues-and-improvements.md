# 11 — Code Quality, Technical Debt, Risks & Improvements

This document outlines verified technical debt, security and architectural risks, and concrete recommendations for evolution.

---

## 1. Technical Debt & Package Cleanup

### Issue 1: `@strapi/plugin-graphql` listed in Root Frontend `package.json`
- **Location**: `package.json` (Line 19)
- **Problem**: `@strapi/plugin-graphql` is a server-side Strapi plugin. It has been mistakenly installed as a dependency in the frontend Vite application.
- **Evidence**:
  ```json
  "dependencies": {
    "@strapi/plugin-graphql": "^5.59.0",
    "graphql": "^16.14.2",
    "graphql-request": "^7.4.0"
  }
  ```
- **Impact**: Bloats `node_modules` in the frontend root and creates potential build confusion, although it is never imported in `src/`.
- **Recommended Action**: Remove it from the root:
  ```powershell
  npm uninstall @strapi/plugin-graphql
  ```

---

## 2. Architectural Risks & Improvements

### Issue 2: In-Memory Session Storage in `word-to-strapi-service`
- **Location**: `word-to-strapi-service/src/importStore.ts`
- **Problem**: The preview/confirm workflow relies on an in-memory `Map<string, PendingImport>`.
- **Impact**:
  - If the service restarts or crashes between `/preview` and `/confirm`, pending imports are lost.
  - In a scaled environment with multiple container instances, a `/confirm` request routed to a different instance will fail with HTTP 404.
- **Recommended Action**:
  - For production, replace the in-memory map with a Redis key-value store with standard 30-minute key expiration.

---

### Issue 3: In-Memory Image Buffering for Large Documents
- **Location**: `word-to-strapi-service/src/index.ts` (`multer.memoryStorage()`)
- **Problem**: Word documents and extracted images are held completely in RAM as Node.js `Buffer` objects.
- **Impact**: If several users simultaneously upload 10MB `.docx` files with multiple high-resolution photos, Node.js heap memory usage can spike.
- **Recommended Action**: For higher concurrency, configure Multer with disk storage (`multer.diskStorage`) or stream uploads directly to temporary files.

---

### Issue 4: SQLite Database in Production
- **Location**: `my-strapi/config/database.ts`
- **Problem**: Strapi is configured to use SQLite via `better-sqlite3` at `.tmp/data.db`.
- **Impact**:
  - SQLite locks the entire database file during writes, making it unsuitable for multi-threaded or multi-instance horizontal scaling.
  - In serverless/container platforms (e.g. Docker, Kubernetes, AWS ECS), ephemeral filesystems will lose data upon redeployment unless a persistent volume is mounted.
- **Recommended Action**:
  - Switch to PostgreSQL or MySQL for production by setting `DATABASE_CLIENT=postgres` and configuring `DATABASE_URL`.

---

## 3. Frontend & Svelte 5 Evolution

### Issue 5: Svelte 5 Runes Modernization
- **Location**: `src/App.svelte`, `src/lib/ConnectionStatus.svelte`, `src/lib/DataViewer.svelte`
- **Observation**:
  - `Counter.svelte` already uses Svelte 5 runes (`let count = $state(0)`).
  - However, `App.svelte` and other components still use Svelte 4 legacy reactivity syntax (`let activeTab = 'explorer'`, `export let status = 'idle'`, `$: recordCount = ...`).
- **Impact**: Svelte 5 maintains backward compatibility with Svelte 4 syntax, so the code works properly today. However, transitioning fully to Svelte 5 runes (`$state()`, `$derived()`, `$props()`) will improve type safety and performance.
- **Example Modernization for `ConnectionStatus.svelte`**:
  ```svelte
  <script>
    let { status = 'idle', endpoint = '', responseTime = null } = $props();
  </script>
  ```

---

## 4. Security Considerations

### 1. `IMPORT_API_KEY` in Frontend Source
- **Observation**: In `src/lib/ImportPage.svelte`, `const IMPORT_API_KEY = 'dev_local_key_123'` is hardcoded in the frontend client script.
- **Analysis**:
  - For local development, this is an acceptable convenience mechanism.
  - However, because client code is visible in the browser developer tools, this key should never be treated as a secret in production.
  - In a public production deployment, protect `/api/import/*` endpoints using standard session cookies or JWT tokens issued by an authentication provider.

### 2. Strapi API Token Permissions
- Verify in **Strapi Admin → Settings → API Tokens** that the token used in `word-to-strapi-service/.env` is granted **Custom** permissions restricted solely to:
  - `api::article.article`: `create`, `find`, `findOne`
  - `plugin::upload`: `upload`
  - **Do NOT grant Full Access tokens** to automated services.
