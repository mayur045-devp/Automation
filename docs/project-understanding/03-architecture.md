# 03 — Overall System Architecture & Data Flow

## 1. Architectural Philosophy

The system adheres to **Clean Architecture** principles and the **Principle of Least Privilege**:
1. **Frontend Isolation**: The browser is treated as a public, untrusted execution environment. It possesses no administrative tokens for Strapi and no Gemini AI keys.
2. **Backend Microservice as Secure Gateway**: Complex, compute-heavy, and sensitive tasks (parsing `.docx` binary files, communicating with Google Gemini AI, managing Strapi write credentials) are quarantined inside `word-to-strapi-service`.
3. **Decoupled Data Reads vs Writes**:
   - **Reads** occur directly between the Svelte frontend and Strapi 5's GraphQL API (`/graphql`) for maximum performance, selective field querying, and schema introspection.
   - **Writes** (Content Creation) strictly occur via the backend service through Strapi 5's authenticated REST API (`/api/articles?status=draft`) and Media Upload API (`/api/upload`).
4. **Draft Safety**: The system enforces that automated processes can only create draft records (`publishedAt: null`). Only an authenticated editor in the Strapi Admin UI can publish articles to production.

---

## 2. Mermaid Diagrams

### Diagram 1: High-Level System Architecture

```mermaid
graph TB
    subgraph ClientLayer["Frontend Client (Port 5173)"]
        Browser["User Browser"]
        SvelteApp["Svelte 5 SPA (App.svelte)"]
        GQLClient["graphql-request Client"]
        ImportUI["ImportPage Component"]
        Browser --> SvelteApp
        SvelteApp --> GQLClient
        SvelteApp --> ImportUI
    end

    subgraph ServiceLayer["Automation Gateway (Port 3001)"]
        Express["Express Server (index.ts)"]
        AuthFilter["X-Import-Key Auth Filter"]
        MammothEngine["Mammoth .docx Extractor"]
        AIEngine["Gemini 1.5 Flash / Rule-Based Mapper"]
        ZodValidator["Zod Schema Validator"]
        SessionStore["In-Memory Store (30-min TTL)"]
        StrapiNodeClient["StrapiClient (REST + Upload)"]

        Express --> AuthFilter
        AuthFilter --> MammothEngine
        MammothEngine --> AIEngine
        AIEngine --> ZodValidator
        ZodValidator --> SessionStore
        SessionStore --> StrapiNodeClient
    end

    subgraph ExternalAI["External AI Platform"]
        GeminiAPI["Google AI Studio (gemini-1.5-flash)"]
    end

    subgraph CMSLayer["Strapi 5 CMS (Port 1337)"]
        StrapiServer["Strapi Core Engine"]
        GQLPlugin["@strapi/plugin-graphql (/graphql)"]
        RESTPlugin["REST API Router (/api/articles)"]
        UploadPlugin["Media Library (/api/upload)"]
        DB[(SQLite Database .tmp/data.db)]
        AdminUI["Strapi Admin Panel (/admin)"]

        StrapiServer --> GQLPlugin
        StrapiServer --> RESTPlugin
        StrapiServer --> UploadPlugin
        StrapiServer --> AdminUI
        GQLPlugin --> DB
        RESTPlugin --> DB
        UploadPlugin --> DB
    end

    %% Network Connections
    GQLClient -- "1. Read/Introspect (POST /graphql)" --> GQLPlugin
    ImportUI -- "2. Upload .docx (POST /api/import/preview)" --> Express
    ImportUI -- "3. Approve Import (POST /api/import/confirm)" --> Express
    AIEngine -- "Structured Prompt" --> GeminiAPI
    StrapiNodeClient -- "Authenticated Draft Create & Upload" --> RESTPlugin
    StrapiNodeClient -- "Upload Media" --> UploadPlugin
```

---

### Diagram 2: End-to-End Request and Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Human Editor
    participant UI as Svelte UI (Browser)
    participant Svc as Word-to-Strapi Service (:3001)
    participant AI as Gemini 1.5 Flash
    participant Strapi as Strapi 5 (:1337)
    participant DB as SQLite Database

    Note over User, UI: Stage 1: Document Upload & Analysis
    User->>UI: Drops sample-article.docx
    UI->>Svc: POST /api/import/preview (multipart/form-data)
    Svc->>Svc: Extract headings, tables, body & images (Mammoth)
    alt Gemini Key Present
        Svc->>AI: Send document text with strict system prompt
        AI-->>Svc: Return structured JSON (Title, slug, description, content)
    else No AI Key (Offline / Fallback)
        Svc->>Svc: Execute ruleBasedMapping()
    end
    Svc->>Svc: Validate payload with Zod (StrapiArticlePayloadSchema)
    Svc->>Strapi: GET /api/articles?filters[Title][$eq]=... (Duplicate Check)
    Strapi-->>Svc: No duplicate found
    Svc->>Svc: Save in session store (importId, TTL 30m)
    Svc-->>UI: 200 OK (importId, preview payload, confidence, missing fields)

    Note over User, UI: Stage 2: Human Review & Approval
    UI-->>User: Renders Field Mapping Preview & Warnings
    User->>UI: Clicks "Approve & Create Draft"
    UI->>Svc: POST /api/import/confirm { importId }
    Svc->>Svc: Retrieve session payload & extracted images
    Svc->>Strapi: POST /api/articles?status=draft { data: payload }
    Strapi->>DB: Insert record (publishedAt: null)
    DB-->>Strapi: Created id, documentId
    Strapi-->>Svc: 201 Created { documentId: "..." }

    opt Document has embedded image
        Svc->>Strapi: POST /api/upload (refId: id, ref: article, field: coverImage)
        Strapi-->>Svc: Media uploaded (id: 42)
    end

    Note over Svc, Strapi: Stage 3: Verification
    Svc->>Strapi: GET /api/articles/{documentId}?status=draft
    Strapi-->>Svc: Return saved fields
    Svc->>Svc: diffPayload(expected, actual)
    Svc->>Svc: Delete importId from memory
    Svc-->>UI: 200 OK (documentId, adminLink, verification: {ok: true})
    UI-->>User: Displays green success badge with Strapi Admin link
```

---

### Diagram 3: Frontend Component & State Architecture

```mermaid
graph TD
    subgraph Root["main.js"]
        Mount["mount(App, target: #app)"]
    end

    subgraph Shell["App.svelte (Application Shell)"]
        ActiveTab{"activeTab state"}
        TopNav["Top Navigation Bar (Logo, Tab Switcher, Strapi Admin link)"]
        ConnectBtn["Connect / Reconnect Action"]
        Hero["Hero Header & Config Strip"]
    end

    subgraph Tab1["activeTab === 'explorer'"]
        ConnStatus["ConnectionStatus.svelte"]
        SchemaExp["SchemaExplorer.svelte"]
        DataView["DataViewer.svelte"]
        SetupGuide["Quick Setup Guide Card"]
        EnvDev["Dev Environment Details Panel"]
    end

    subgraph Tab2["activeTab === 'import'"]
        Import["ImportPage.svelte"]
        DropZone["Drag & Drop Zone (.docx, max 10MB)"]
        PreviewSection["Preview Card (Field Grid, Stats, Warnings)"]
        SuccessSection["Success Card (documentId, Verification, Admin link)"]
    end

    subgraph NetworkLayer["src/lib/ Network Layer"]
        GraphQLJS["graphql.js (GraphQLClient wrapper)"]
        QueriesJS["strapiQueries.js (pingStrapi, fetchStrapiSchema, fetchCollection)"]
    end

    Mount --> Shell
    Shell --> TopNav
    Shell --> ActiveTab
    ActiveTab -->|'explorer'| Tab1
    ActiveTab -->|'import'| Tab2

    Tab1 --> ConnStatus
    Tab1 --> SchemaExp
    Tab1 --> DataView
    Tab1 --> SetupGuide
    Tab1 --> EnvDev

    Tab2 --> Import
    Import --> DropZone
    Import --> PreviewSection
    Import --> SuccessSection

    ConnStatus -.-> QueriesJS
    SchemaExp -.-> QueriesJS
    DataView -.-> QueriesJS
    QueriesJS --> GraphQLJS
```

---

### Diagram 4: Runtime Flow — Live GraphQL Query Execution

```mermaid
sequenceDiagram
    actor Developer
    participant UI as DataViewer.svelte
    participant Queries as strapiQueries.js
    participant GQL as graphql.js
    participant Strapi as Strapi 5 (/graphql)

    Developer->>UI: Types collection name ("articles") & fields ("Title, description")
    Developer->>UI: Clicks "Run Query" or hits Enter
    UI->>Queries: fetchCollection("articles", ["Title", "description"])
    Note over Queries: Automatically prepends "documentId" & de-duplicates fields
    Queries->>GQL: gqlQuery(generatedQueryString)
    GQL->>Strapi: POST /graphql { query: "query Fetch_articles { articles { documentId Title description } }" }
    alt Success 200 OK
        Strapi-->>GQL: { data: { articles: [ ... ] } }
        GQL-->>Queries: { data: { ... }, error: null }
        Queries-->>UI: Returns data
        UI->>UI: Computes recordCount and formats JSON
        UI-->>Developer: Renders interactive result cards & formatted JSON
    else GraphQL Syntax / Permission Error
        Strapi-->>GQL: { errors: [ { message: "Cannot query field..." } ] }
        GQL-->>Queries: { data: null, error: "Cannot query field..." }
        Queries-->>UI: Returns error message
        UI-->>Developer: Displays red Query Error alert banner
    end
```
