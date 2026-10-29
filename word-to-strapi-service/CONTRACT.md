# DOCX import contract

## Dynamic collection targets

The Word Import workflow uses the authenticated Strapi Content-Type Builder API to discover all user-defined collection types and single types. GraphQL introspection does not filter this list. `STRAPI_IMPORT_COLLECTIONS` may restrict discovered UIDs. If authorized discovery is unavailable, the service reports the limitation and falls back to the static Article/Blog registry; that fallback cannot include newly created content types.

`GET /api/import/collections` requires a `connectionOrigin` that matches the configured `STRAPI_URL` origin. `POST /api/import/collections/refresh` re-fetches authorized live metadata and replaces the cache. Content-Type Builder access requires a server-side `STRAPI_ADMIN_JWT` with the relevant read permission. GraphQL introspection does not prove create permission: Strapi enforces the service token's actual permissions on each REST operation. The uploader does not accept a browser-provided URL or token.

Preview requests pass `collectionId` and `connectionOrigin` with the DOCX. The service resolves the target from current live metadata or its static fallback, maps only supported fields for that target, validates the payload against the target schema, and stores the trusted target identity with the preview. Confirm re-resolves the target, rechecks the connection origin and payload, checks the configured duplicate identifier, creates a draft at the target-derived REST route, and verifies the created entry. Unknown fields from AI output are ignored and reported. Relations and unsupported components are not guessed.

The schema-aware generic mapper compares extracted fields with the selected live schema and classifies compatible, missing, conflicting, and unsupported fields. Simple scalar additions and explicitly inferred image fields can be reviewed and approved individually. The Content-Type Builder update route is development-only in supported Strapi setups and requires authorized admin access; production deployments that do not expose this route must add fields through Strapi's supported project schema workflow, then refresh and re-analyze. Existing fields are never replaced or removed. Components, dynamic zones, relations, localization, and uncertain nested structures require manual configuration.

## What changed

The previous preview exposed a Strapi payload limited to `Title`, `slug`, `description`, and `content`. The extraction layer already recognized some extra labels, but the payload builder discarded them. The updated preview separates:

- `fields`: recognized document values, including nested `defaultSeo` and non-CMS fields.
- `fieldStates`: one extraction status per known document field (`extracted`, `explicitly_empty`, `missing`, `unresolved`, `requires_review`, or `invalid`), plus `uploadStatus` (`ready`, `manual`, `unsupported`, `not_ready`, or `blocked`), with a reason and original value when available.
- `unmappedFields`: unknown labels and values retained for review.
- `payload`: only verified, valid Strapi Article attributes.
- `missingFields`, `ambiguities`, and `warnings`: extraction and mapping diagnostics.

The preview UI displays all extracted fields and states in addition to the resulting payload. The `confirm` route remains create-only and creates drafts; an existing title match returns a conflict instead of updating an entry.

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
| Content New | DOCX sections | `contentNew` (repeatable `component.content-new`) | One ordered component per detected section; Blocks for rich text and `contentHtml` for ordered table-capable HTML |
| Button | `button` | `button.link` | Map only URL/path-shaped values |
| Button Title | `buttontitle` | `buttontitle` (string) | Map as a scalar |
| Button Subtitle | `buttonsubtitle` | `buttonsubtitle` (string) | Map as a scalar |
| Blog Categories | `blogcategories` | `tital_blog_category` (one-to-one Article relation) | Retain unresolved; category text cannot identify an Article document relation |
| Time | `time` | `time` (string) | Map as a scalar |
| FAQ Section | `faqsection` | No attribute in current Article schema | Retain for review; exclude from CMS payload |
| Form Section | `formsection` | No attribute in current Article schema | Retain for review; exclude from CMS payload |
| Popularity Name | `popularityname` | No attribute in current Article schema | Retain for review; exclude from CMS payload |

These are explicit mappings, not automatic camel-case conversions. The Strapi schema currently contains no declared required attributes, so the import does not invent or enforce additional required values.

## Structured sections, Blocks, and tables

The DOCX converter uses Mammoth's semantic HTML output to preserve document order, paragraphs, headings, lists, links, and actual table rows/cells. Section boundaries are recognized from Word heading styles, standalone bold paragraphs, and Markdown heading markers; section titles are not hardcoded. Each section becomes one item in the repeatable `contentNew` component array.

`contentNew.content` remains a Strapi Blocks field. Paragraphs, headings, lists, supported inline formatting, and safe hyperlinks are serialized as Strapi Blocks nodes and validated before the REST request. Blocks has no table node, so an optional additive `contentHtml` text attribute stores the section's complete ordered HTML (including paragraphs around one or more semantic `<table>` elements). Existing `content` data is not changed. The import preview and reusable `ContentNewRenderer.svelte` sanitize HTML against an explicit tag/attribute/URL allowlist; tables scroll horizontally on narrow screens.

The expected REST payload remains Strapi 5's `{ "data": { ... } }` envelope, with `contentNew: [{ "title": "...", "content": [...], "contentHtml": "..." }]`. Component mapping is enabled only for the verified `component.content-new` UID when the parent attribute is repeatable. A collection without that exact schema displays detected sections as unmapped and cannot be imported until they are mapped. Confirm re-fetches the created entry with the component populated and compares the saved component values with the approved preview.

The repository contains the import dashboard and a reusable renderer, but no public-site content page or CMS-backed route. A production website must consume `contentHtml` through the renderer (or an equivalent sanitized renderer) to display these tables. The local schema file and generated type were updated only after explicit approval; no live CMS write or migration was performed. Restart Strapi and verify the component schema before importing.

## Preview request and response

Request: `POST /api/import/preview`, multipart form-data with a `.docx` `file` and the existing `X-Import-Key` header.

Example response (values shortened):

```json
{
  "importId": "generated-import-id",
  "preview": {
    "fields": {
      "title": "How AI Is Transforming Digital Business",
      "description": "Explore how businesses use AI...",
      "defaultSeo": {
        "metaTitle": "How AI Is Transforming Digital Business | 12th Wonder",
        "keywords": []
      },
      "date": "2026-10-26",
      "categoryname": "Digital Transformation"
    },
    "fieldStates": {
      "title": { "status": "extracted", "uploadStatus": "ready" },
      "defaultSeo.keywords": { "status": "explicitly_empty", "uploadStatus": "not_ready" },
      "cover": {
        "status": "unresolved",
        "uploadStatus": "manual",
        "reason": "Template instruction or placeholder, not a field value."
      },
      "faqsection": {
        "status": "unresolved",
        "uploadStatus": "unsupported",
        "reason": "No matching attribute exists in the current Strapi Article schema."
      }
    },
    "payload": {
      "Title": "How AI Is Transforming Digital Business",
      "slug": "how-ai-is-transforming-digital-business",
      "description": "Explore how businesses use AI...",
      "date": "2026-10-26",
      "categoryName": "Digital Transformation",
      "seo": {
        "metaTitle": "How AI Is Transforming Digital Business | 12th Wonder"
      }
    },
    "missingFields": [],
    "unmappedFields": [
      { "label": "Cover", "value": "Leave empty — add/select the cover image in Strapi." },
      { "label": "Authordata", "value": "Leave empty — add the correct author entry/relation." },
      { "label": "FAQ Section", "value": "Leave empty — add FAQ items if needed." },
      { "label": "Popularity Name", "value": "Trending" }
    ],
    "ambiguities": [
      "cover: Template instruction or placeholder, not a field value.",
      "authordata: Template instruction or placeholder, not a field value."
    ],
    "warnings": [],
    "confidence": "low",
    "imageCount": 0,
    "wordCount": 120,
    "duplicateDocumentId": null
  }
}
```

In the current implementation, `missingFields` lists only absent fields; explicitly empty and unresolved fields are represented in `fieldStates`. Manual/unsupported values remain in `unmappedFields` or the extraction `fields` object, not the CMS payload.

## CMS payload and uploader behavior

`confirm` sends the selected collection's Strapi 5 REST draft-creation request with `{ "data": <payload> }`. Single types are handled as one shared entry and do not use collection duplicate checks. The client does not update existing documents. An existing matching collection entry causes a `409` conflict; no existing entry is overwritten.

The uploader validates the preview against the selected content type and omits unresolved relations, unsupported fields, and empty/missing values. Mammoth extracts embedded image bytes and retains stable image indices, captions, alt text, and nearby document locations. A confidently identified image can be assigned automatically; otherwise the preview permits manual image-to-field assignment. The service uploads assigned binary files to Strapi's upload endpoint with the entry ID, content type UID, and media field name, then verifies each uploaded media ID is linked in the saved entry. Unassigned images must be explicitly skipped; no image reference or CMS ID is fabricated.

If a separate teammate-owned uploader consumes the preview response, it must:

1. Use `preview.payload` as the only CMS payload; do not send `preview.fields` directly.
2. Preserve the `seo`, `Authordata`, and `button` component object shapes.
3. Keep `fieldStates` out of the CMS request and honor non-`extracted` states as non-uploadable.
4. Preserve each image's binary and preview metadata, and use an explicit `fieldStates` or user-approved image-to-field assignment; never attach the first arbitrary image or fabricate a Strapi media ID.
5. Continue using Strapi 5 `documentId` for any explicitly implemented update workflow and require a verified match/confirmation. No update workflow is currently implemented.
