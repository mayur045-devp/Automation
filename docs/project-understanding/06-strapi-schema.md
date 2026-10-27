# 06 — Strapi 5 Content Schema & Data Models

## 1. Strapi 5 Architectural Foundations

Strapi 5 introduces key architectural changes compared to Strapi 4:
1. **Document Service & `documentId`**:
   - In Strapi 5, every content entry has an immutable, unique, string-based `documentId` (e.g. `"v7ptey5dt0h1rydhnre4u2b4"`).
   - The integer `id` is an internal auto-increment primary key used for database relations.
   - All public REST and GraphQL queries in Strapi 5 use `documentId` as the primary identifier.
2. **Draft & Publish Engine**:
   - Draft and published versions of a document share the same `documentId`.
   - When querying via REST, `?status=draft` or `?status=published` controls which document state is retrieved.
   - For all creation operations in this project, entries are created with `status=draft`.

---

## 2. Article Collection Type Schema (`api::article.article`)

- **Schema File**: `my-strapi/src/api/article/content-types/article/schema.json`
- **Kind**: `collectionType`
- **Collection Name**: `articles`
- **Draft & Publish**: Enabled (`true`)

### Attribute Table

| Field Name | Type | Options / Configuration | Purpose | Handled in Automation Service? |
|---|---|---|---|---|
| `Title` | `string` | PascalCase attribute name | Main article headline | ✅ Yes (Extracted & Mapped) |
| `slug` | `uid` | `targetField: "Title"`, `required: false` | Clean URL slug | ✅ Yes (Generated via `slugify()`) |
| `description` | `text` | Short text (max 1000 chars) | Summary / abstract | ✅ Yes (Extracted & Mapped) |
| `content` | `richtext` | Markdown / Rich Text | Full article body | ✅ Yes (Main body only) |
| `coverImage` | `media` | `multiple: false`, `allowedTypes: ["images"]` | Featured header image | ✅ Yes (Uploaded to `/api/upload` & attached) |
| `date` | `date` | ISO 8601 Date string | Publication date | In Schema (Omitted from draft payload unless mapped) |
| `seo` | `component` | Component: `seo.seo`, `repeatable: false` | Search engine metadata | In Schema (Extracted in AI, omitted from draft) |
| `tital_blog_category`| `relation` | `relation: "oneToOne"`, target: `api::article.article` | Category relation | In Schema |
| `Authordata` | `component` | Component: `component.author-data`, `repeatable: false`| Author details | In Schema |
| `categoryName` | `string` | Category title | Category name | In Schema |
| `contentNew` | `component` | Component: `component.content-new`, `repeatable: false` | Structured blocks content | In Schema |
| `button` | `component` | Component: `component.button`, `repeatable: false` | CTA button | In Schema |
| `buttontitle` | `string` | Short string | Button header | In Schema |
| `buttonsubtitle`| `string` | Short string | Button subtitle | In Schema |
| `time` | `string` | Reading time duration (e.g. "5 min") | Reading duration | In Schema |
| `polldata` | `component` | Component: `component.polldata`, `repeatable: false` | Interactive poll block | In Schema |
| `Quizedata` | `component` | Component: `component.quizedata`, `repeatable: false` | Interactive quiz block | In Schema |

---

## 3. Strapi Component Schemas

### 3.1 `seo.seo`
- **Definition**: `my-strapi/src/components/seo/seo.json`
- **Attributes**:
  - `metaTitle`: `string`
  - `metaDescription`: `string`
  - `keywords`: `text`
  - `metaRobots`: `string`
  - `structuredData`: `string`
  - `metaViewport`: `string`
  - `canonicalURL`: `string`
  - `metaImage`: `media` (multiple)
  - `metaSocial`: `media` (multiple)

### 3.2 `component.author-data`
- **Definition**: `my-strapi/src/components/component/author-data.json`
- **Attributes**:
  - `title`: `string`
  - `authorName`: `string`
  - `Authordesignation`: `string`
  - `image`: `media` (multiple)

### 3.3 `component.content-new`
- **Definition**: `my-strapi/src/components/component/content-new.json`
- **Attributes**:
  - `title`: `string`
  - `content`: `blocks` (Strapi 5 native rich text blocks)

### 3.4 `component.button`
- **Definition**: `my-strapi/src/components/component/button.json`
- **Attributes**:
  - `name`: `string`
  - `link`: `string`

### 3.5 `component.polldata`
- **Definition**: `my-strapi/src/components/component/polldata.json`
- **Attributes**:
  - `title`: `string`
  - `subtitle`: `string`
  - `position`: `integer`
  - `isActive`: `boolean`
  - `options`: `component` (`component.options`, non-repeatable)

### 3.6 `component.quizedata`
- **Definition**: `my-strapi/src/components/component/quizedata.json`
- **Attributes**:
  - `question`: `string`
  - `position`: `integer`
  - `isActive`: `boolean`
  - `options`: `component` (`component.options`, repeatable)

### 3.7 `component.options`
- **Definition**: `my-strapi/src/components/component/options.json`
- **Attributes**:
  - `label`: `string`
  - `votes`: `integer`
  - `isCorrect`: `boolean`

---

## 4. REST Payload Construction Rules in Automation Service

The automation service constructs Strapi 5 payloads using `buildStrapiPayload(fields)` in `word-to-strapi-service/src/schema.ts`:

```typescript
{
  "data": {
    "Title": "The Future of Renewable Energy",
    "slug": "the-future-of-renewable-energy",
    "description": "Renewable energy sources are rapidly transforming...",
    "content": "## Solar and Wind\n\nSolar energy production has surged..."
  }
}
```

### Safety and Field Independence Guarantees
- **Case Sensitivity**: Notice that `Title` is capitalized in Strapi's schema (`schema.json`). The service strictly adheres to PascalCase `"Title"`. Sending lowercase `"title"` would fail or result in an unmapped column in Strapi.
- **Never Concatenates Metadata into Content**: Author information, buttons, FAQs, and SEO tags are **never** dumped into the article body `content`. If not mapped to a target schema field, they are gracefully omitted and flagged in the preview as unmapped.
