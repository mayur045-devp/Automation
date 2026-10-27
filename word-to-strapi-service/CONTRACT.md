# DOCX import contract

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
| Content New | `contentnew` | `contentNew` (component with Blocks) | Retain for review; do not invent a Blocks structure from plain text |
| Button | `button` | `button.link` | Map only URL/path-shaped values |
| Button Title | `buttontitle` | `buttontitle` (string) | Map as a scalar |
| Button Subtitle | `buttonsubtitle` | `buttonsubtitle` (string) | Map as a scalar |
| Blog Categories | `blogcategories` | `tital_blog_category` (one-to-one Article relation) | Retain unresolved; category text cannot identify an Article document relation |
| Time | `time` | `time` (string) | Map as a scalar |
| FAQ Section | `faqsection` | No attribute in current Article schema | Retain for review; exclude from CMS payload |
| Form Section | `formsection` | No attribute in current Article schema | Retain for review; exclude from CMS payload |
| Popularity Name | `popularityname` | No attribute in current Article schema | Retain for review; exclude from CMS payload |

These are explicit mappings, not automatic camel-case conversions. The Strapi schema currently contains no declared required attributes, so the import does not invent or enforce additional required values.

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

`confirm` sends `POST /api/articles?status=draft` with `{ "data": <payload> }`, using Strapi 5 REST draft creation. The client does not update existing documents. An existing draft with the same Title causes a `409` conflict; no slug-based match or update is attempted.

The uploader accepts the expanded allowlisted payload keys `Title`, `slug`, `description`, `content`, `date`, `seo`, `Authordata`, `categoryName`, `button`, `buttontitle`, `buttonsubtitle`, and `time`. It intentionally omits unresolved relations, unsupported fields, and empty/missing values. An embedded image is uploaded to `coverImage` only when the DOCX explicitly references that image in its Cover field; unrelated embedded images are never guessed to be the cover.

If a separate teammate-owned uploader consumes the preview response, it must:

1. Use `preview.payload` as the only CMS payload; do not send `preview.fields` directly.
2. Preserve the `seo`, `Authordata`, and `button` component object shapes.
3. Keep `fieldStates` out of the CMS request and honor non-`extracted` states as non-uploadable.
4. Resolve the media index from `fieldStates.cover.imageIndex` only when present; never attach the first arbitrary embedded image.
5. Continue using Strapi 5 `documentId` for any explicitly implemented update workflow and require a verified match/confirmation. No update workflow is currently implemented.
