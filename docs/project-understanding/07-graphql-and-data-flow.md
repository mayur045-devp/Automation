# 07 — GraphQL Architecture & Data Flow

## 1. GraphQL Integration Architecture

In this system, GraphQL is used exclusively for **querying and schema exploration** on the frontend client.

```
┌────────────────────────────────────────────────────────┐
│                      Frontend SPA                      │
│                                                        │
│  src/lib/graphql.js (GraphQLClient from graphql-request)│
│  src/lib/strapiQueries.js (Query Constructors)         │
└───────────────────────────┬────────────────────────────┘
                            │
               HTTP POST /graphql (JSON Body)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                 Strapi 5 GraphQL Plugin                │
│                 (@strapi/plugin-graphql)               │
│                                                        │
│  - Shadow CRUD Enabled                                 │
│  - Endpoint: /graphql                                  │
│  - GraphQL Playground: /graphql (always enabled)       │
│  - Depth Limit: 7                                      │
│  - Amount Limit: 100                                   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Client Initialization & Authentication

Defined in [`src/lib/graphql.js`](file:///c:/Users/ADMIN/OneDrive/Desktop/automate/src/lib/graphql.js):

```javascript
import { GraphQLClient } from 'graphql-request'

const GRAPHQL_URL = import.meta.env.VITE_STRAPI_GRAPHQL_URL || 'http://localhost:1337/graphql'
const TOKEN = import.meta.env.VITE_STRAPI_TOKEN || ''

export const client = new GraphQLClient(GRAPHQL_URL, {
  headers: TOKEN
    ? { Authorization: `Bearer ${TOKEN}` }
    : {},
})
```

### Access Modes
1. **Public Access Mode (Default)**:
   - When `VITE_STRAPI_TOKEN` is blank or unset, no `Authorization` header is sent.
   - Requires permissions to be set in **Strapi Admin → Settings → Users & Permissions plugin → Roles → Public**.
   - For `Article`, check **find** and **findOne**.
2. **Authenticated Access Mode**:
   - Setting `VITE_STRAPI_TOKEN` in `.env` automatically attaches `Bearer <TOKEN>` to every request.

---

## 3. Query Definitions and Execution

Defined in [`src/lib/strapiQueries.js`](file:///c:/Users/ADMIN/OneDrive/Desktop/automate/src/lib/strapiQueries.js):

### 3.1 Connectivity Ping Query
Used by `ConnectionStatus` on page load to test whether Strapi is online:
```graphql
query Ping {
  __typename
}
```
Execution: `pingStrapi()` returns `{ data: { __typename: "Query" }, error: null }`.

### 3.2 Full Schema Introspection Query
Used by `SchemaExplorer` to discover all available collections and query fields dynamically:
```graphql
query IntrospectSchema {
  __schema {
    queryType {
      fields {
        name
        description
        type {
          name
          kind
        }
      }
    }
  }
}
```

### 3.3 Dynamic Collection Query Builder
Used by `DataViewer` to construct valid GraphQL queries based on user input:
```javascript
export async function fetchCollection(collectionName, fields = []) {
  // Base fields that exist on all Strapi 5 content-types
  const allFields = ['documentId', ...fields]
  const uniqueFields = Array.from(new Set(allFields))
  const fieldList = uniqueFields.join('\n      ')

  const query = `
    query Fetch_${collectionName} {
      ${collectionName} {
        ${fieldList}
      }
    }
  `
  return gqlQuery(query)
}
```

Example generated query when requesting collection `articles` with field `Title`:
```graphql
query Fetch_articles {
  articles {
    documentId
    Title
  }
}
```

---

## 4. Standardized Error Handling

All queries pass through `gqlQuery(query, variables)`:

```javascript
export async function gqlQuery(query, variables = {}) {
  try {
    const data = await client.request(query, variables)
    return { data, error: null }
  } catch (err) {
    console.error('[GraphQL Error]', err)
    const message =
      err?.response?.errors?.[0]?.message ||
      err?.message ||
      'Unknown GraphQL error'
    return { data: null, error: message }
  }
}
```

This ensures components never crash on network exceptions or GraphQL syntax errors; errors are captured and returned cleanly as a string for display in UI alert banners.
