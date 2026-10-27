# 10 — Configuration, Dependencies, and Environment Setup

## 1. Environment Variables Specification

The repository distributes configuration across three separate environment files to maintain strict credential isolation:

### 1.1 Frontend Environment (`.env` in Workspace Root)

| Variable | Purpose | Used In | Required? | Safe Example / Default |
|---|---|---|---|---|
| `VITE_STRAPI_URL` | Base HTTP address for Strapi CMS | `src/App.svelte` | No (defaults to localhost) | `http://localhost:1337` |
| `VITE_STRAPI_GRAPHQL_URL` | GraphQL HTTP endpoint for queries | `src/lib/graphql.js`, `src/App.svelte` | No (defaults to localhost) | `http://localhost:1337/graphql` |
| `VITE_STRAPI_TOKEN` | Optional Strapi API bearer token | `src/lib/graphql.js` | No (Leave blank for public access) | Sanitized string or blank |

*Security Rule: Never put administrative or write tokens in the frontend `.env` file, as all `VITE_*` variables are embedded into client-side JS bundles.*

---

### 1.2 Automation Service Environment (`word-to-strapi-service/.env`)

| Variable | Purpose | Used In | Required? | Safe Example / Default |
|---|---|---|---|---|
| `STRAPI_URL` | Base HTTP address for Strapi REST API | `src/index.ts`, `src/strapiClient.ts` | Yes | `http://localhost:1337` |
| `STRAPI_API_TOKEN` | Strapi API Token with Article create/find and Upload permissions | `src/index.ts`, `src/strapiClient.ts` | Yes | Generated in Strapi Admin → Settings → API Tokens |
| `GEMINI_API_KEY` | Google Gemini API Key for intelligent mapping | `src/index.ts`, `src/mapper.ts` | No (Fallback to rule-based) | From https://ai.google.dev |
| `GEMINI_MODEL` | Gemini model name | `src/index.ts`, `src/mapper.ts` | No | `gemini-1.5-flash` |
| `PORT` | Local HTTP port for Express microservice | `src/index.ts` | No | `3001` |
| `IMPORT_API_KEY` | Dev shared secret verified via `X-Import-Key` | `src/index.ts` | Recommended in dev | `dev_local_key_123` |

---

### 1.3 Strapi CMS Environment (`my-strapi/.env`)

| Variable | Purpose | Used In | Required? | Safe Example / Default |
|---|---|---|---|---|
| `HOST` | HTTP interface binding | `config/server.ts` | Yes | `0.0.0.0` |
| `PORT` | Strapi server port | `config/server.ts` | Yes | `1337` |
| `APP_KEYS` | Cookie session signing keys | `config/server.ts` | Yes | Comma-separated random strings |
| `API_TOKEN_SALT` | Salt for hashing Strapi API tokens | `config/admin.ts` | Yes | Random base64 string |
| `ADMIN_JWT_SECRET` | Secret for Strapi Admin dashboard JWTs | `config/admin.ts` | Yes | Random base64 string |
| `TRANSFER_TOKEN_SALT` | Salt for data transfer tokens | `config/admin.ts` | Yes | Random base64 string |
| `JWT_SECRET` | Secret for Users-Permissions JWTs | `config/plugins.ts` | Yes | Random base64 string |
| `DATABASE_CLIENT` | Database dialect | `config/database.ts` | No (defaults to sqlite) | `sqlite` |
| `DATABASE_FILENAME` | Relative path to SQLite file | `config/database.ts` | No | `.tmp/data.db` |

---

## 2. Tooling & Configuration Files

### 2.1 Frontend `jsconfig.json`
- Configured with `"moduleResolution": "bundler"` and `"target": "ESNext"`.
- Enables `"checkJs": true` to provide TypeScript-style typechecking directly within `.js` and `.svelte` files without requiring a `.ts` rewrite.
- Includes `src/**/*.d.ts`, `src/**/*.js`, and `src/**/*.svelte`.

### 2.2 Frontend `svelte.config.js`
- Imports `@sveltejs/vite-plugin-svelte` type definitions.
- Default empty export (`export default {}`), allowing Vite to handle component preprocessing automatically.

### 2.3 Backend `word-to-strapi-service/tsconfig.json`
- Targets `ES2022` with CommonJS module output (`"module": "commonjs"`).
- Enables `"esModuleInterop": true` and `"resolveJsonModule": true` for loading JSON schemas and CommonJS packages like `mammoth`.
- Compiles `src/*.ts` files into `dist/*.js`.

### 2.4 Testing Configuration: `word-to-strapi-service/vitest.config.ts`
- Uses Vitest for fast, native TypeScript testing without bundling.
- Configured with `globals: true` and `environment: 'node'`.
