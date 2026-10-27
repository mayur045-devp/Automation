# Word-to-Strapi AI Content Automation

An end-to-end system that extracts structured content from Microsoft Word (`.docx`) files, maps and validates article fields (using Google Gemini AI or rule-based fallback), provides a human approval preview, and creates verified **DRAFT** entries in Strapi 5 with media uploads and duplicate prevention.

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
- **Strapi 5 CMS (Port 1337)**: Headless CMS storing `Article` collection entries in **draft** mode (`publishedAt: null`).

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
STRAPI_API_TOKEN=fc9c3b902d709d1ef087e2e7732975c1c68ecab869dfd929dfb229d9fb5fb42a2e4ba93024c934ce6ba52f50dc3cea6aabb83e7bfc1363176aefe390d18cf8f9d1f65b8ff1b46cbca2a260874565f429057e5bc1cc4937c9ca423958599ee40d6824299d7b27d96aa0b876dfec3b758acbaac61dd2ecd0ce6b175497a09ab7a6

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
4. Click **"Generate Preview"**:
   - The backend extracts text, headings, and images.
   - It performs duplicate detection against Strapi.
   - It displays a preview showing the mapped `Title`, `slug`, `description`, `content` body, image count, and any unmapped metadata.
5. Review the preview and click **"Approve & Create Draft in Strapi"**:
   - Creates a **DRAFT** entry in Strapi 5 (`POST /api/articles?status=draft`).
   - Uploads any embedded images to Strapi Media Library.
   - Re-fetches the created entry from Strapi to verify field-by-field accuracy.
   - Displays the Strapi `documentId` and direct link to Strapi Admin.

---

## Running Automated Tests

To run the unit and validation tests across the backend service:

```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\word-to-strapi-service
npm test
```

### What is tested:
- **Zod Validation**: Validates `Title`, `slug`, `description`, and `content` constraints; verifies empty optional fields are handled safely.
- **Slug Generation**: Tests lowercasing, special character stripping, hyphen formatting, and truncation.
- **Mammoth Extraction**: Tests heading extraction, paragraph parsing, bullet list preservation, and image placeholder separation.
- **Field Independence**: Confirms author, date, categories, buttons, FAQs, and SEO data are extracted separately and never dumped into main article body `content`.

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

### 2. `POST /api/import/preview`
Uploads a `.docx` file, extracts content, runs mapping & validation, and returns a preview session.
- **Request**: `multipart/form-data` with field `file` (`.docx` binary, max 10 MB).
- **Response**:
```json
{
  "importId": "349e2897-99ca-483c-a3d8-ce012f6b9842",
  "preview": {
    "payload": {
      "Title": "The Future of Renewable Energy",
      "slug": "the-future-of-renewable-energy",
      "description": "Renewable energy sources are rapidly transforming...",
      "content": "# The Future of Renewable Energy\n\n..."
    },
    "missingFields": ["coverImage (no images in document)"],
    "ambiguities": [],
    "confidence": "medium",
    "imageCount": 0,
    "wordCount": 156,
    "duplicateDocumentId": null
  }
}
```

### 3. `POST /api/import/confirm`
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
  "adminLink": "http://localhost:1337/admin/content-manager/collection-types/api::article.article/v7ptey5dt0h1rydhnre4u2b4",
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
5. **Idempotent Draft Creation**: Checks for existing articles with identical titles to prevent duplicate draft pollution.
6. **Re-fetch Verification**: Every newly created Strapi draft is immediately fetched back from the REST API and compared against approved preview values to guarantee data fidelity.

---

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `401 Unauthorized` | Invalid `X-Import-Key` or `STRAPI_API_TOKEN` | Verify `IMPORT_API_KEY` and `STRAPI_API_TOKEN` in `word-to-strapi-service/.env`. |
| `403 Forbidden` | Strapi API Token lacks permissions | Go to Strapi Admin → Settings → API Tokens. Grant **Article: create, find** and **Upload: upload**. |
| `Cannot connect to service` | Service on port 3001 is stopped | Run `npm start` in `word-to-strapi-service/`. |
| `409 Conflict (Duplicate)` | Article with same Title already exists | Delete the existing draft in Strapi Admin or edit the Title before importing. |
| Port already in use | Previous process still running on port | Stop existing processes on ports 1337, 3001, or 5173 before launching. |
