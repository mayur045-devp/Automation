# 01 — Project Overview

## 1. Executive Summary

This repository contains a full-stack content engineering and publishing platform composed of three coordinated tiers:
1. **Frontend Client (`/`)**: A Single Page Application (SPA) built with **Svelte 5** and **Vite**, styled with **Tailwind CSS v4**, communicating with Strapi through GraphQL and with the backend automation service through REST.
2. **Strapi Headless CMS (`/my-strapi`)**: An enterprise headless CMS running **Strapi 5.59.0** with SQLite (`better-sqlite3`), configured with the `@strapi/plugin-graphql` plugin for schema introspection and querying, and standard REST endpoints for draft creation.
3. **Word-to-Strapi AI Content Service (`/word-to-strapi-service`)**: A Node.js/TypeScript microservice running on Express that parses Microsoft Word documents (`.docx`), extracts structural components using **Mammoth**, performs field-level schema mapping and validation using **Google Gemini 1.5 Flash** (with intelligent rule-based fallback), isolates credentials, checks idempotency/duplicates, and posts verified **DRAFT** content into Strapi 5.

---

## 2. Technology Stack Verification

The following stack was verified directly against the repository's configuration files and package manifests:

| Tier | Component | Technology / Library | Version | Verification Source |
|---|---|---|---|---|
| **Frontend** | UI Framework | Svelte (Svelte 5 Runes) | `^5.57.2` | `package.json` |
| **Frontend** | Build Tool | Vite | `^8.3.4` | `package.json`, `vite.config.js` |
| **Frontend** | Compiler Plugin | `@sveltejs/vite-plugin-svelte` | `^7.3.1` | `package.json`, `vite.config.js` |
| **Frontend** | CSS Framework | Tailwind CSS v4 (`@tailwindcss/vite`) | `^4.3.3` | `package.json`, `vite.config.js`, `src/app.css` |
| **Frontend** | GraphQL Client | `graphql-request` & `graphql` | `^7.4.0` / `^16.14.2` | `src/lib/graphql.js` |
| **CMS** | Core Platform | Strapi Community Edition | `5.59.0` | `my-strapi/package.json` |
| **CMS** | Database Engine | SQLite via `better-sqlite3` | `12.11.1` | `my-strapi/config/database.ts` |
| **CMS** | GraphQL Engine | `@strapi/plugin-graphql` | `^5.59.0` | `my-strapi/config/plugins.ts` |
| **Backend Service** | Runtime | Node.js + Express (CommonJS) | Express `^4.19.2` | `word-to-strapi-service/package.json` |
| **Backend Service** | Language | TypeScript | `^5.4.5` | `word-to-strapi-service/tsconfig.json` |
| **Backend Service** | Document Parser | Mammoth (`mammoth`) | `^1.8.0` | `word-to-strapi-service/src/extract.ts` |
| **Backend Service** | AI Engine | Google Generative AI (`@google/generative-ai`) | `^0.21.0` | `word-to-strapi-service/src/mapper.ts` |
| **Backend Service** | Schema & Validation | Zod (`zod`) | `^3.23.8` | `word-to-strapi-service/src/schema.ts` |
| **Backend Service** | Testing Engine | Vitest (`vitest`) | `^1.6.0` | `word-to-strapi-service/vitest.config.ts` |

### Architectural Clarification: SvelteKit vs Svelte SPA
- The repository does **not** employ SvelteKit (`@sveltejs/kit`). There are no `+page.svelte`, `+page.server.ts`, or `+layout.svelte` file-based routes.
- The frontend is a high-performance **Vite + Svelte 5 Single Page Application (SPA)** mounted directly onto `#app` in `index.html` via `mount(App, { target: ... })`.
- Routing is managed using reactive client state (`activeTab: 'explorer' | 'import'`).

### Multilingual / Internationalization (i18n) Status
- Verified: **No internationalization (i18n) or Japanese language routing** is configured in this repository.
- Strapi's `i18n` plugin fields are explicitly excluded in `src/lib/SchemaExplorer.svelte` (`!f.name.startsWith('i18N')`).
- The content models in `my-strapi` do not enable localized attributes.

---

## 3. High-Level System Architecture

```
┌────────────────────────────────────────────────────────┐
│             Frontend SPA (Port 5173)                   │
│   Svelte 5 · Tailwind CSS v4 · graphql-request         │
│   ├── Tab 1: GraphQL Schema Explorer & Data Viewer    │
│   └── Tab 2: Word-to-Strapi Document Import Studio    │
└──────────────┬───────────────────────────┬─────────────┘
               │                           │
   GraphQL / Introspection                 │ REST (multipart .docx)
   (Port 1337)                             │ (Port 3001)
               ▼                           ▼
┌──────────────────────────────┐ ┌─────────────────────────────────────────┐
│     Strapi 5 CMS (1337)      │ │   Word-to-Strapi Service (3001)         │
│   @strapi/plugin-graphql     │ │   Express · Mammoth · Zod · Gemini AI   │
│   REST API (/api/articles)   │ │   ├── Memory-buffered extraction        │
│   Media Upload (/api/upload) │ │   ├── Structured LLM Prompt Injection   │
│   SQLite Database (.tmp)     │ │   └── 30-min In-Memory Import Store     │
└──────────────▲───────────────┘ └────────────────────┬────────────────────┘
               │                                      │
               └────────── Authenticated REST ────────┘
                    (POST /api/articles?status=draft)
                    (POST /api/upload)
```

---

## 4. Key Security & Architecture Guarantees

1. **Credential Isolation**: Strapi Administrative API tokens and Google Gemini API keys exist exclusively in `word-to-strapi-service/.env`. The frontend client never has access to privileged write tokens.
2. **Drafts Only by Design**: All imported documents are posted with `status=draft`. Automatic publishing is prohibited, ensuring human review in Strapi Admin.
3. **Prompt Injection Defense**: Input `.docx` text is treated as untrusted data. The system instruction strictly prohibits command execution from document content.
4. **Idempotency & Duplicate Prevention**: Before creating any entry, the service queries Strapi by title equality to prevent duplicate drafts.
5. **Re-fetch Verification**: When a draft is created in Strapi, it is re-fetched and diffed against the approved payload to guarantee zero data loss.
