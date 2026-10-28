# Word-to-Strapi AI Content Automation

An end-to-end system that extracts structured content from Microsoft Word (`.docx`) files, maps and validates content against a selected verified Strapi collection (using Google Gemini AI or rule-based fallback), provides a human approval preview, and creates verified **DRAFT** entries with duplicate prevention.

---

## Architecture Overview

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐       ┌────────────────────────┐
│        Svelte Frontend          │       │     word-to-strapi-service      │       │        Strapi 5        │
│      http://localhost:5173      │ ───►  │      http://localhost:3001      │ ───►  │ http://localhost:1337   │
│   (Upload, Review & Approve)    │       │ (Mammoth + Gemini AI + Express) │       │ (REST API & SQLite DB) │
└─────────────────────────────────┘       └─────────────────────────────────┘       └────────────────────────┘
```

- **Frontend (Port 5173)**: Svelte + Tailwind application with a dedicated **Word Import** workflow page. Never touches Strapi tokens or AI keys.
- **Backend Service (Port 3001)**: Node.js + TypeScript service using Express, Mammoth (safe `.docx` extraction), Zod (schema validation), and Google Gemini AI (`gemini-1.5-flash`). Holds all credentials securely.
- **Strapi 5 CMS (Port 1337)**: Headless CMS storing imports in a selected supported collection in **draft** mode (`publishedAt: null`).

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Windows / macOS / Linux**

---

## Environment & Configuration

Credentials and configuration are stored **exclusively** on the backend:

📁 **Location**: [`word-to-strapi-service/.env`](file:///c:/Users/ADMIN/OneDrive/Desktop/automate/word-to-strapi-service/.env)

```env
# Strapi Connection
STRAPI_URL=http://localhost:1337
STRAPI_API_TOKEN=your_strapi_api_token_here
# Optional server-side Strapi Admin JWT for authorized discovery and schema changes.
STRAPI_ADMIN_JWT=

# AI Configuration (OPTIONAL)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash

# Backend Service Config
PORT=3001
IMPORT_API_KEY=dev_local_key_123
```

### About the Google Gemini API Key
> [!NOTE]
> **The Gemini API Key is OPTIONAL.**
> - **Without a key (`GEMINI_API_KEY=` blank)**: The service automatically uses intelligent **rule-based extraction**. It extracts headings as `Title`, opening paragraphs as `description`, separates metadata, generates the `slug`, and formats body text for `content`. Everything runs locally with zero external API calls.
> - **With a key**: Get a free key at [Google AI Studio](https://ai.google.dev). The service will use Google Gemini (`gemini-1.5-flash`) with structured JSON schema outputs to analyze, summarize, and map ambiguous content.

### Collection import targets

When `STRAPI_ADMIN_JWT` is configured with authorized Content-Type Builder read access, the service discovers user-defined collection types and single types directly from Strapi. GraphQL query visibility is not used to filter the selector. Without authorized live discovery, the service reports the limitation and uses its static Article/Blog fallback. The selector supports search and refresh, and shows each type's display name, API identifier, and type. `STRAPI_IMPORT_COLLECTIONS` can restrict discovered UIDs.

The origin of `VITE_STRAPI_GRAPHQL_URL` must match `STRAPI_URL` in the import service. The browser's schema and collection selection are not trusted for writes: the service validates the UID against authorized live metadata or its static fallback, and Strapi itself enforces API-token permissions. Administrative credentials remain server-side.

Schema comparison is part of the import preview. Simple additive fields can be proposed and applied only after explicit approval and only when Strapi's authorized Content-Type Builder update route is available (development mode). Existing attributes are never replaced. Other structures, conflicts, and unsupported fields require manual configuration or an explicit decision to skip.

---

## How to Run the Full Project

Run each component in its own terminal window (PowerShell, Command Prompt, or Bash):

### Terminal 1: Strapi 5 CMS (Port 1337)
```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\my-strapi
npm run develop
```
- **Admin Dashboard**: [http://localhost:1337/admin](http://localhost:1337/admin)
- **API Endpoint**: [http://localhost:1337/api](http://localhost:1337/api)

---

### Terminal 2: Word-to-Strapi Service (Port 3001)
```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\word-to-strapi-service
npm install
npm run build
npm start
```
*(For development with live TypeScript execution, you can run `npm run dev`)*
- **Health Check**: [http://localhost:3001/health](http://localhost:3001/health)

---

### Terminal 3: Svelte Frontend (Port 5173)
```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate
npm install
npm run dev
```
- **Web App**: [http://localhost:5173](http://localhost:5173)

---

## User Guide: Importing a Word Document

1. Open **[http://localhost:5173](http://localhost:5173)** in your browser.
2. Click the **"📄 Word Import"** tab in the top navigation bar.
3. Drag and drop any `.docx` file (e.g. [`sample-article.docx`](file:///c:/Users/ADMIN/OneDrive/Desktop/automate/word-to-strapi-service/sample-article.docx)) into the drop zone.
4. Click **"Analyse for [collection]"**:
   - The backend extracts text, headings, and images.
   - It performs duplicate detection against Strapi.
   - It displays the selected destination, target-specific payload, image count, and unsupported or unmapped metadata.
5. Review the selected destination, payload, schema diff, and extracted images. Assign ambiguous images to media fields or explicitly skip them.
6. If simple fields are missing, approve the additions and apply them before re-analyzing. Content-Type Builder schema updates are available only when supported by the connected Strapi environment.
7. Click **"Import to [collection]"** only after reviewing the schema and image assignments:
   - Creates a **DRAFT** entry using the selected collection's verified Strapi 5 REST route (for example, Blog uses `POST /api/blogs?status=draft`).
   - Embedded image binaries are uploaded and attached to the selected media fields using Strapi's upload API.
   - Re-fetches the created entry from the selected collection to verify the saved fields.
   - Displays the Strapi `documentId`, selected collection, and Admin link.

---

## Running Automated Tests

To run the unit and validation tests across the backend service:

```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\word-to-strapi-service
npm test
```

### What is tested:
- **Schema Validation**: Validates the Article payload and verified Blog scalar payload; rejects unknown targets and unsupported fields.
- **Slug Generation**: Tests lowercasing, special character stripping, hyphen formatting, and truncation.
- **Mammoth Extraction**: Tests heading extraction, paragraph parsing, bullet list preservation, and image placeholder separation.
- **Field Independence**: Confirms author, date, categories, buttons, FAQs, and SEO data are extracted separately and never dumped into main article body `content`.
- **Collection Import Mapping**: Verifies the selected Blog schema drives AI mapping and the mocked Strapi create request targets `/api/blogs`, while Article imports remain supported.

---

## API Reference (`word-to-strapi-service`)

All endpoints accept or require the `X-Import-Key: dev_local_key_123` header for service authentication.

### 1. `GET /health`
Returns service status and configuration flags.
```json
{
  "ok": true,
  "strapiUrl": "http://localhost:1337",
  "geminiModel": "gemini-1.5-flash",
  "geminiKeySet": false,
  "strapiTokenSet": true
}
```

### 2. `GET /api/import/collections?connectionOrigin=http%3A%2F%2Flocalhost%3A1337`

Returns the verified backend collection registry after checking that the GraphQL connection origin matches `STRAPI_URL`. The frontend intersects this list with the collection query fields returned by GraphQL introspection.

### 3. `POST /api/import/preview`
Uploads a `.docx` file, extracts content, runs mapping & validation, and returns a preview session.
- **Request**: `multipart/form-data` with `file` (`.docx`, max 10 MB), `collectionId` (a verified UID), and `connectionOrigin`.
- **Response**:
```json
{
  "importId": "349e2897-99ca-483c-a3d8-ce012f6b9842",
  "preview": {
    "collection": {
      "uid": "api::blog.blog",
      "displayName": "Blog",
      "apiName": "blogs"
    },
    "payload": {
      "title": "The Future of Renewable Energy",
      "description": "Renewable energy sources are rapidly transforming...",
      "content": "The future of renewable energy..."
    },
    "missingFields": [],
    "ambiguities": [],
    "confidence": "medium",
    "imageCount": 0,
    "wordCount": 156,
    "duplicateDocumentId": null
  }
}
```

### 4. `POST /api/import/confirm`
Approves a preview session and creates the draft entry in Strapi 5.
- **Request**:
```json
{ "importId": "349e2897-99ca-483c-a3d8-ce012f6b9842" }
```
- **Response**:
```json
{
  "success": true,
  "documentId": "v7ptey5dt0h1rydhnre4u2b4",
  "collection": { "uid": "api::blog.blog", "displayName": "Blog" },
  "adminLink": "http://localhost:1337/admin/content-manager/collection-types/api::blog.blog/v7ptey5dt0h1rydhnre4u2b4",
  "previewLink": "http://localhost:5173",
  "uploadedImageId": null,
  "verification": {
    "ok": true,
    "mismatches": []
  }
}
```

---

## Key Safety & Design Guarantees

1. **Drafts Only**: Entries are strictly created with `status=draft`. Content is never published automatically.
2. **Credential Isolation**: Strapi tokens and AI keys live solely inside `word-to-strapi-service/.env`. Frontend clients never receive tokens.
3. **Prompt Injection Defense**: All `.docx` input is treated as untrusted text and guarded against embedded model instructions.
4. **No Fact Fabrication**: Unfound fields are flagged as `missingFields` rather than guessed or fabricated.
5. **Idempotent Draft Creation**: Checks for existing entries with the selected collection's configured identifier field to prevent duplicate drafts.
6. **Re-fetch Verification**: Every newly created Strapi draft is immediately fetched back from the REST API and compared against approved preview values to guarantee data fidelity.

---

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `401 Unauthorized` | Invalid `X-Import-Key` or `STRAPI_API_TOKEN` | Verify `IMPORT_API_KEY` and `STRAPI_API_TOKEN` in `word-to-strapi-service/.env`. |
| `403 Forbidden` | Strapi API Token lacks permissions | Go to Strapi Admin → Settings → API Tokens. Grant **find/create** for the selected content type; Article media imports also need **Upload: upload**. |
| `Cannot connect to service` | Service on port 3001 is stopped | Run `npm start` in `word-to-strapi-service/`. |
| `409 Conflict (Duplicate)` | A draft with the selected collection's identifier already exists | Delete the existing draft in Strapi Admin or change the identifier before importing. |
| Port already in use | Previous process still running on port | Stop existing processes on ports 1337, 3001, or 5173 before launching. |
