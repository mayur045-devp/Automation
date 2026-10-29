# DOCX import contract

## Dynamic collection targets

The Word Import workflow uses the authenticated Strapi Content-Type Builder API to discover all user-defined collection types and single types. GraphQL introspection does not filter this list. `STRAPI_IMPORT_COLLECTIONS` may restrict discovered UIDs. If authorized discovery is unavailable, the service reports the limitation and falls back to the static Article/Blog registry; that fallback cannot include newly created content types.

`GET /api/import/collections` requires a `connectionOrigin` that matches the configured `STRAPI_URL` origin. `POST /api/import/collections/refresh` re-fetches authorized content-type and component metadata and replaces the cache. Discovery requires a server-side `STRAPI_ADMIN_JWT` with read permission. The token is used only to read schemas; schema creation and update routes are disabled. The uploader does not accept a browser-provided URL or token.

Preview requests pass `collectionId` and `connectionOrigin` with the DOCX. The service resolves the target from current live metadata or its verified static fallback, recursively discovers component attributes, maps only fields in that target schema, validates the final payload, and stores the trusted target identity with the preview. Confirm re-resolves the target, rechecks the connection origin and payload, checks the configured duplicate identifier, creates a draft at the target-derived REST route, and verifies the created entry. Extra document content is ignored. Optional missing fields are omitted. Relations are never guessed from display text.

Only the selected collection schema controls payload field names, types, enum values, required checks, and component structure. Unsupported optional content is omitted; invalid values and unmet required constraints produce explicit validation errors. The service never creates or modifies Strapi schemas.

## What changed

The preview displays only values in the normalized payload that will be sent to Strapi, with component values rendered as destination field paths. Technical payload and extraction diagnostics are available only in the collapsed debug panel.

The `confirm` route remains create-only and creates drafts; an existing matching entry returns a conflict instead of updating it.

## Verified field mapping

The mappings below use the current `my-strapi/src/api/article/content-types/article/schema.json` and its checked-in component schemas.

| Document field | Internal field | Strapi field | Mapping behavior |
|---|---|---|---|
| Title | `title` | `Title` (string) | Upload when extracted |
| Description | `description` | `description` (text) | Upload when extracted |
| Slug | `slug` | `slug` (UID) | Use the provided slug or derive from a valid title |
| Cover | `cover` | `coverImage` (single image media) | Upload only when an embedded image is explicitly placed in the Cover field |
| Default SEO / `metaTitle` | `defaultSeo.metaTitle` | `seo.metaTitle` | Map to the `seo.seo` component |
| Default SEO / `metaDescription` | `defaultSeo.metaDescription` | `seo.metaDescription` | Map to the `seo.seo` component |
| Default SEO / `keywords` | `defaultSeo.keywords` | `seo.keywords` (text) | Serialize a supplied keyword list as comma-separated text |
| Default SEO / `metaRobots` | `defaultSeo.metaRobots` | `seo.metaRobots` | Map to the `seo.seo` component |
| Default SEO / `structuredData` | `defaultSeo.structuredData` | `seo.structuredData` | Map to the `seo.seo` component |
| Default SEO / `metaViewPort` | `defaultSeo.metaViewPort` | `seo.metaViewport` | Map the label casing to the actual component attribute |
| Default SEO / `canonicalURL` | `defaultSeo.canonicalURL` | `seo.canonicalURL` | Map to the `seo.seo` component |
| Default SEO / `shareImage` | `defaultSeo.shareImage` | No verified match | Retain as unresolved; the SEO component exposes `metaImage` and `metaSocial`, not `shareImage` |
| Content | `content` | `content` (richtext string) | Preserve source text and headings/lists; do not combine metadata |
| Date | `date` | `date` | Accept only a real `YYYY-MM-DD` date |
| Authordata | `authordata` | `Authordata.authorName` | Map a provided author name to the component; no relation or media identifier is inferred |
| Category Name | `categoryname` | `categoryName` (string) | Map as a scalar |
| Content New | DOCX sections | `contentNew` (repeatable `component.content-new`) | One ordered `{ title, content }` text component per detected section; tables are represented as readable rows |
| Button | `button` | `button.link` | Map only URL/path-shaped values |
| Button Title | `buttontitle` | `buttontitle` (string) | Map as a scalar |
| Button Subtitle | `buttonsubtitle` | `buttonsubtitle` (string) | Map as a scalar |
| Blog Categories | `blogcategories` | `tital_blog_category` (one-to-one Article relation) | Retain unresolved; category text cannot identify an Article document relation |
| Time | `time` | `time` (string) | Map as a scalar |
| FAQ Section | `faqsection` | No attribute in current Article schema | Retain for review; exclude from CMS payload |
| Form Section | `formsection` | No attribute in current Article schema | Retain for review; exclude from CMS payload |
| Popularity Name | `popularityname` | No attribute in current Article schema | Retain for review; exclude from CMS payload |

These mappings illustrate the checked-in Article fallback only. Live collections use their discovered schema, including actual required and enum constraints. No missing value is invented.

## Structured sections and tables

The DOCX converter uses Mammoth's semantic output and document structure to preserve order, paragraphs, headings, lists, hyperlinks, and table rows/cells. Section boundaries are recognized from Word heading styles, standalone bold paragraphs, and Markdown heading markers; section titles are not hardcoded. Each section becomes one item in the repeatable `contentNew` component array when the selected schema exposes compatible `title` and `content` fields.

For the checked-in component, `contentNew.content` is a Strapi text field. The importer sends a readable text representation with paragraph breaks, Markdown-style inline formatting and links, list markers, and pipe-separated table rows. It never sends `contentHtml` or unsupported component keys.

The expected REST payload remains Strapi 5's `{ "data": { ... } }` envelope, with `contentNew: [{ "title": "...", "content": "..." }]`. A collection without a compatible repeatable section component simply omits that content; it is not blocked for lacking an optional destination. Confirm re-fetches the created entry with components populated and compares saved values with the approved preview.

The importer performs no schema writes or CMS writes during preview. Import confirmation is the only content-creation operation.

## Preview request and response

Request: `POST /api/import/preview`, multipart form-data with a `.docx` `file` and the existing `X-Import-Key` header.

Example response (values shortened):

```json
{
  "importId": "generated-import-id",
  "preview": {
    "collection": { "displayName": "Articles", "apiName": "articles" },
    "documentName": "article.docx",
    "payload": {
      "Title": "How AI Is Transforming Digital Business",
      "slug": "how-ai-is-transforming-digital-business",
      "description": "Explore how businesses use AI...",
      "contentNew": [
        { "title": "Introduction", "content": "The complete section text..." }
      ]
    },
    "images": [],
    "duplicateDocumentId": null,
    "debug": { "fieldStates": {} }
  }
}
```

The preview `payload` is the normalized object used by confirmation. Diagnostics and intentionally ignored document fields are isolated under `debug`.

## CMS payload and uploader behavior

`confirm` sends the selected collection's Strapi 5 REST draft-creation request with `{ "data": <payload> }`. Single types are handled as one shared entry and do not use collection duplicate checks. The client does not update existing documents. An existing matching collection entry causes a `409` conflict; no existing entry is overwritten.

The uploader validates the preview against the selected content type and omits unresolved relations, unsupported optional fields, and empty/missing values. Mammoth extracts embedded image bytes and retains stable image indices, captions, alt text, and nearby document locations. A confidently identified image can be assigned automatically; otherwise the preview permits manual assignment to a supported top-level media field. Assigned binary files are uploaded to Strapi's upload endpoint and verified. Images with no supported media destination are safely ignored; no image reference or CMS ID is fabricated.

If a separate teammate-owned uploader consumes the preview response, it must:

1. Use `preview.payload` as the only CMS payload; do not send `preview.fields` directly.
2. Preserve the `seo`, `Authordata`, and `button` component object shapes.
3. Keep `fieldStates` out of the CMS request and honor non-`extracted` states as non-uploadable.
4. Preserve each image's binary and preview metadata, and use an explicit `fieldStates` or user-approved image-to-field assignment; never attach the first arbitrary image or fabricate a Strapi media ID.
5. Continue using Strapi 5 `documentId` for any explicitly implemented update workflow and require a verified match/confirmation. No update workflow is currently implemented.
