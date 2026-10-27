# 02 — Complete Folder and File Structure

## 1. Project Root Directory Map

The repository is structured as a multi-tier monorepo containing three distinct applications, documentation, and shared assets:

```
automate/ (Workspace Root)
├── .env                              # Frontend Vite client environment variables
├── .gitignore                        # Git ignore rules for root repository
├── index.html                        # HTML5 document entry point (Vite SPA shell)
├── jsconfig.json                     # JS/Svelte typechecking and module resolution config
├── package.json                      # Root npm manifest (Frontend dependencies & scripts)
├── package-lock.json                 # Exact lockfile for root frontend dependencies
├── README.md                         # Primary project documentation and quickstart guide
├── svelte.config.js                  # Svelte compiler configuration
├── vite.config.js                    # Vite bundler configuration (Tailwind & Svelte plugins)
│
├── docs/                             # Architecture and schema documentation
│   ├── field-mapping.md              # Initial audit of Strapi Article schema mapping
│   └── project-understanding/        # Comprehensive architectural documentation suite
│
├── public/                           # Static public assets served untouched by Vite
│   └── favicon.svg                   # Browser tab icon
│
├── src/                              # Svelte 5 frontend application source code
│   ├── App.svelte                    # Root application component and state router
│   ├── app.css                       # Global design system, CSS tokens, and Tailwind v4 setup
│   ├── main.js                       # Svelte 5 entry script (mounts App to #app)
│   ├── assets/                       # Bundled static media
│   │   ├── hero.png                  # Visual brand graphic
│   │   ├── svelte.svg                # Svelte brand icon
│   │   └── vite.svg                  # Vite brand icon
│   └── lib/                          # Reusable components and API helpers
│       ├── ConnectionStatus.svelte   # Real-time Strapi GraphQL latency and status card
│       ├── Counter.svelte            # Vite starter demo counter (Svelte 5 runes demo)
│       ├── DataViewer.svelte         # Interactive collection query console
│       ├── ImportPage.svelte         # Word-to-Strapi import workflow UI
│       ├── SchemaExplorer.svelte     # Introspected GraphQL fields and types explorer
│       ├── graphql.js                # Low-level GraphQLClient wrapper using graphql-request
│       └── strapiQueries.js          # Predefined GraphQL queries & dynamic query builder
│
├── my-strapi/                        # Strapi 5 Headless CMS instance
│   ├── .env                          # Strapi secrets and database credentials
│   ├── .env.example                  # Environment template for Strapi setup
│   ├── .gitignore                    # Strapi git exclusion list (.tmp, dist, cache)
│   ├── package.json                  # Strapi npm dependencies and development scripts
│   ├── tsconfig.json                 # TypeScript compiler configuration for Strapi
│   ├── config/                       # Strapi runtime configuration
│   │   ├── admin.ts                  # Admin dashboard configuration & secrets
│   │   ├── api.ts                    # REST API global defaults
│   │   ├── database.ts               # Database dialect (SQLite) and connection settings
│   │   ├── middlewares.ts            # Middleware execution pipeline (CORS, security, logger)
│   │   ├── plugins.ts                # Plugin configurations (GraphQL, users-permissions, upload)
│   │   └── server.ts                 # HTTP server host, port, and webhook settings
│   ├── database/                     # Database migrations
│   ├── src/                          # Strapi application source code
│   │   ├── index.ts                  # Strapi lifecycle hooks (register, bootstrap)
│   │   ├── api/                      # Domain API modules
│   │   │   └── article/              # Article collection type definition
│   │   │       ├── content-types/
│   │   │       │   └── article/
│   │   │       │       └── schema.json # Core Article database schema & relations
│   │   │       ├── controllers/
│   │   │       │   └── article.ts    # Core controller factory
│   │   │       ├── routes/
│   │   │       │   └── article.ts    # Core router factory
│   │   │       └── services/
│   │   │           └── article.ts    # Core service factory
│   │   └── components/               # Reusable Strapi component schemas
│   │       ├── component/            # Data components (AuthorData, button, polldata, quizedata, etc.)
│   │       ├── name/                 # Supplemental button schema
│   │       └── seo/                  # SEO component schema (metaTitle, keywords, robots, etc.)
│   └── types/                        # Auto-generated TypeScript types
│
└── word-to-strapi-service/           # Word (.docx) AI import microservice
    ├── .env                          # Backend secrets (STRAPI_API_TOKEN, GEMINI_API_KEY, PORT)
    ├── .env.example                  # Sanitized template for service environment variables
    ├── .gitignore                    # Node modules and build output exclusions
    ├── package.json                  # Microservice dependencies (Express, Mammoth, Zod, Gemini)
    ├── tsconfig.json                 # TypeScript compiler settings for CommonJS build
    ├── vitest.config.ts              # Unit test runner configuration
    ├── sample-article.docx           # Test input document for validation and verification
    └── src/                          # Service implementation code
        ├── index.ts                  # Express server, CORS, route handlers, error handling
        ├── extract.ts                # Mammoth .docx extractor (tables, headings, images, lists)
        ├── mapper.ts                 # Google Gemini AI mapper + Rule-based fallback mapper
        ├── schema.ts                 # Zod validation schemas & JSON Schema for Gemini
        ├── strapiClient.ts           # Strapi 5 REST API client with retry and error handling
        ├── importStore.ts            # In-memory session store (30-min TTL) for approval workflow
        ├── extract.test.ts           # Test suite for document parsing and image handling
        ├── mapper.test.ts            # Test suite for field independence and AI mapping
        └── schema.test.ts            # Test suite for Zod validation, slugs, and payload builds
```

---

## 2. Detailed Folder and Purpose Breakdown

### 2.1 Workspace Root (`/`)
- **Purpose**: Hosts the client-side user interface. When `npm run dev` is executed here, Vite serves the application on `http://localhost:5173`.
- **Dependencies**: Depends on `@sveltejs/vite-plugin-svelte`, `@tailwindcss/vite`, `graphql-request`, and `graphql`.
- **Classification**: Essential (Application Tier 1).

### 2.2 `src/` & `src/lib/`
- **Purpose**: Svelte component library and GraphQL integration layer.
- **Why it exists**: Separates the UI views (`App.svelte`, `ImportPage.svelte`) from specialized widgets (`ConnectionStatus.svelte`, `SchemaExplorer.svelte`, `DataViewer.svelte`) and network query functions (`graphql.js`, `strapiQueries.js`).
- **Classification**: Essential.

### 2.3 `my-strapi/`
- **Purpose**: The centralized headless content management system.
- **Why it exists**: Provides the relational SQLite database, Strapi Admin dashboard (`/admin`), GraphQL endpoint (`/graphql`), and REST API (`/api/articles`).
- **Dependencies**: `@strapi/strapi`, `@strapi/plugin-graphql`, `better-sqlite3`.
- **Classification**: Essential (Application Tier 2).

### 2.4 `word-to-strapi-service/`
- **Purpose**: Standalone secure middleware bridge.
- **Why it exists**: Isolates the `.docx` document processing, AI logic, and secret API tokens from both the client browser and the Strapi core codebase.
- **Dependencies**: Express, Mammoth, Zod, `@google/generative-ai`, Vitest.
- **Classification**: Essential (Application Tier 3).

### 2.5 `docs/`
- **Purpose**: System architecture, field audits, and developer guides.
- **Classification**: Essential (Documentation).
