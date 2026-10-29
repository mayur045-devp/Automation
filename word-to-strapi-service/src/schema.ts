import { z } from "zod";

/**
 * Document SEO extraction shape; it maps to the Strapi `seo` component.
 * Contains: metaTitle, metaDescription, keywords, metaRobots, structuredData, metaViewPort, canonicalURL, shareImage.
 */
export const SeoComponentSchema = z
  .object({
    metaTitle: z.string().nullable().optional(),
    metaDescription: z.string().nullable().optional(),
    keywords: z.array(z.string()).optional(),
    metaRobots: z.string().nullable().optional(),
    structureData: z
      .union([
        z.string(),
        z.record(z.any()),
        z.array(z.any()),
        z.number(),
        z.boolean(),
      ])
      .nullable()
      .optional(),
    structuredData: z
      .union([
        z.string(),
        z.record(z.any()),
        z.array(z.any()),
        z.number(),
        z.boolean(),
      ])
      .nullable()
      .optional(),
    metaViewPort: z.string().nullable().optional(),
    canonicalURL: z.string().nullable().optional(),
    shareImage: z
      .union([z.string(), z.array(z.string()), z.record(z.any())])
      .nullable()
      .optional(),
  })
  .strict();

export type SeoComponent = z.infer<typeof SeoComponentSchema>;

/**
 * FAQ Item Schema — for structured FAQ sections.
 */
export const FaqItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

/**
 * Full AI extraction contract — all independent fields that may be present in a Word document.
 * Matches Rule 2.D illustrative mapping contract.
 */
export const DocumentFieldsSchema = z
  .object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    slug: z.string().nullable().optional(),
    cover: z.string().nullable().optional(),
    defaultSeo: SeoComponentSchema.nullable().optional(),
    content: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    authordata: z.string().nullable().optional(),
    categoryname: z.string().nullable().optional(),
    contentnew: z
      .union([z.string(), z.array(z.any()), z.record(z.any())])
      .nullable()
      .optional(),
    contentNew: z
      .union([z.string(), z.array(z.any()), z.record(z.any())])
      .nullable()
      .optional(),
    button: z.string().nullable().optional(),
    buttontitle: z.string().nullable().optional(),
    buttonsubtitle: z.string().nullable().optional(),
    blogcategories: z
      .union([z.array(z.string()), z.string()])
      .nullable()
      .optional(),
    time: z.string().nullable().optional(),
    faqsection: z
      .union([z.array(FaqItemSchema), z.array(z.any()), z.string()])
      .nullable()
      .optional(),
    formsection: z
      .union([z.record(z.any()), z.string()])
      .nullable()
      .optional(),
    popularityname: z.string().nullable().optional(),
  })
  .strict();

export type DocumentFields = z.infer<typeof DocumentFieldsSchema>;

export const DOCUMENT_FIELD_KEYS = [
  "title",
  "description",
  "slug",
  "cover",
  "defaultSeo.metaTitle",
  "defaultSeo.metaDescription",
  "defaultSeo.keywords",
  "defaultSeo.metaRobots",
  "defaultSeo.structureData",
  "defaultSeo.structuredData",
  "defaultSeo.metaViewPort",
  "defaultSeo.canonicalURL",
  "defaultSeo.shareImage",
  "content",
  "date",
  "authordata",
  "categoryname",
  "contentnew",
  "contentNew",
  "button",
  "buttontitle",
  "buttonsubtitle",
  "blogcategories",
  "time",
  "faqsection",
  "formsection",
  "popularityname",
] as const;

export type DocumentFieldKey = (typeof DOCUMENT_FIELD_KEYS)[number];
export type FieldStateStatus =
  | "extracted"
  | "explicitly_empty"
  | "unresolved"
  | "requires_review"
  | "invalid"
  | "missing";

export const FieldStateSchema = z
  .object({
    status: z.enum([
      "extracted",
      "explicitly_empty",
      "unresolved",
      "requires_review",
      "invalid",
      "missing",
    ]),
    uploadStatus: z
      .enum(["ready", "manual", "unsupported", "not_ready", "blocked"])
      .optional(),
    reason: z.string().optional(),
    rawValue: z.string().optional(),
    imageIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FieldState = z.infer<typeof FieldStateSchema>;
export const FieldStatesSchema = z.record(FieldStateSchema);
export type FieldStates = z.infer<typeof FieldStatesSchema>;

export interface DocumentFieldMapping {
  label: string;
  aliases?: readonly string[];
  internalField: DocumentFieldKey;
  strapiField: string | null;
  dataType: string;
  kind: "scalar" | "component" | "media" | "relation" | "unsupported";
  required: boolean;
  localized: boolean;
  extractionStrategy: string;
  validation: string;
  transformation: string;
  automatic: boolean;
  note?: string;
}

/**
 * Verified against the checked-in Strapi article and component schemas.
 */
const FIELD_MAPPING_DEFINITIONS: readonly Omit<
  DocumentFieldMapping,
  | "kind"
  | "required"
  | "localized"
  | "extractionStrategy"
  | "validation"
  | "transformation"
>[] = [
  {
    label: "Title",
    aliases: ["Article Title"],
    internalField: "title",
    strapiField: "Title",
    dataType: "string",
    automatic: true,
  },
  {
    label: "Description",
    aliases: ["Summary", "Abstract"],
    internalField: "description",
    strapiField: "description",
    dataType: "text",
    automatic: true,
  },
  {
    label: "Slug",
    aliases: ["URL Slug"],
    internalField: "slug",
    strapiField: "slug",
    dataType: "uid",
    automatic: true,
  },
  {
    label: "Cover",
    aliases: ["Cover Image", "Cover Photo"],
    internalField: "cover",
    strapiField: "coverImage",
    dataType: "single image media",
    automatic: true,
    note: "Only an image explicitly referenced in the Cover field is eligible.",
  },
  {
    label: "Default SEO / metaTitle",
    aliases: ["SEO Title", "metaTitle", "Default SEO metaTitle"],
    internalField: "defaultSeo.metaTitle",
    strapiField: "seo.metaTitle",
    dataType: "component string",
    automatic: true,
  },
  {
    label: "Default SEO / metaDescription",
    aliases: [
      "SEO Description",
      "metaDescription",
      "Default SEO metaDescription",
    ],
    internalField: "defaultSeo.metaDescription",
    strapiField: "seo.metaDescription",
    dataType: "component string",
    automatic: true,
  },
  {
    label: "Default SEO / keywords",
    aliases: ["SEO Keywords", "keywords", "Default SEO keywords"],
    internalField: "defaultSeo.keywords",
    strapiField: "seo.keywords",
    dataType: "component text",
    automatic: true,
    note: "Keyword arrays are serialized as comma-separated text.",
  },
  {
    label: "Default SEO / metaRobots",
    aliases: ["Robots", "metaRobots", "Default SEO metaRobots"],
    internalField: "defaultSeo.metaRobots",
    strapiField: "seo.metaRobots",
    dataType: "component string",
    automatic: true,
  },
  {
    label: "Default SEO / structureData",
    aliases: ["structureData", "structuredData", "Default SEO structureData", "Default SEO structuredData"],
    internalField: "defaultSeo.structureData",
    strapiField: "seo.structureData",
    dataType: "component json",
    automatic: true,
  },
  {
    label: "Default SEO / structuredData (legacy)",
    aliases: ["structuredData", "Default SEO structuredData"],
    internalField: "defaultSeo.structuredData",
    strapiField: "seo.structuredData",
    dataType: "component string",
    automatic: true,
    note: "Backward-compatible alias for older extraction templates.",
  },
  {
    label: "Default SEO / metaViewPort",
    aliases: [
      "Meta Viewport",
      "Viewport",
      "metaViewport",
      "Default SEO metaViewPort",
    ],
    internalField: "defaultSeo.metaViewPort",
    strapiField: "seo.metaViewport",
    dataType: "component string",
    automatic: true,
  },
  {
    label: "Default SEO / canonicalURL",
    aliases: ["Canonical", "canonicalURL", "Default SEO canonicalURL"],
    internalField: "defaultSeo.canonicalURL",
    strapiField: "seo.canonicalURL",
    dataType: "component string",
    automatic: true,
  },
  {
    label: "Default SEO / shareImage",
    aliases: ["shareImage", "Share Image"],
    internalField: "defaultSeo.shareImage",
    strapiField: "seo.shareImage",
    dataType: "media",
    automatic: true,
    note: "Share image is supported as an explicit media reference; this is only used when the document supplies a concrete image asset.",
  },
  {
    label: "Content",
    aliases: ["Main Content"],
    internalField: "content",
    strapiField: "content",
    dataType: "richtext string",
    automatic: true,
  },
  {
    label: "Date",
    aliases: ["Published Date", "Published"],
    internalField: "date",
    strapiField: "date",
    dataType: "date",
    automatic: true,
  },
  {
    label: "Authordata",
    aliases: ["Author", "By"],
    internalField: "authordata",
    strapiField: "Authordata.authorName",
    dataType: "component",
    automatic: true,
    note: "Maps a provided author name only; no relation or media ID is inferred.",
  },
  {
    label: "Category Name",
    aliases: ["Category"],
    internalField: "categoryname",
    strapiField: "categoryName",
    dataType: "string",
    automatic: true,
  },
  {
    label: "Content New",
    aliases: ["contentNew", "Content New"],
    internalField: "contentNew",
    strapiField: "contentNew",
    dataType: "component with Blocks",
    automatic: true,
    note: "This field is treated as a repeatable component when the document provides a sectioned content block.",
  },
  {
    label: "Content New",
    aliases: ["contentnew", "contentNew"],
    internalField: "contentnew",
    strapiField: "contentNew",
    dataType: "legacy component key",
    automatic: true,
    note: "Backward-compatible alias for older extraction templates.",
  },
  {
    label: "Button",
    aliases: ["Button Text", "Button URL", "Button Link"],
    internalField: "button",
    strapiField: "button.link",
    dataType: "component string",
    automatic: true,
    note: "Only URL/path-shaped values are accepted as links.",
  },
  {
    label: "Button Title",
    aliases: ["buttontitle"],
    internalField: "buttontitle",
    strapiField: "buttontitle",
    dataType: "string",
    automatic: true,
  },
  {
    label: "Button Subtitle",
    aliases: ["buttonsubtitle"],
    internalField: "buttonsubtitle",
    strapiField: "buttonsubtitle",
    dataType: "string",
    automatic: true,
  },
  {
    label: "Blog Categories",
    aliases: ["Categories", "blogcategories"],
    internalField: "blogcategories",
    strapiField: "tital_blog_category",
    dataType: "one-to-one relation",
    automatic: false,
    note: "The current relation targets Article, not a category content type.",
  },
  {
    label: "Time",
    aliases: ["Read Time"],
    internalField: "time",
    strapiField: "time",
    dataType: "string",
    automatic: true,
  },
  {
    label: "FAQ Section",
    aliases: ["FAQ", "Frequently Asked Questions"],
    internalField: "faqsection",
    strapiField: null,
    dataType: "not in schema",
    automatic: false,
  },
  {
    label: "Form Section",
    aliases: ["Form"],
    internalField: "formsection",
    strapiField: null,
    dataType: "not in schema",
    automatic: false,
  },
  {
    label: "Popularity Name",
    aliases: ["Popularity"],
    internalField: "popularityname",
    strapiField: null,
    dataType: "not in schema",
    automatic: false,
  },
];

export const DOCUMENT_FIELD_MAPPINGS: readonly DocumentFieldMapping[] =
  FIELD_MAPPING_DEFINITIONS.map((entry) => ({
    ...entry,
    kind:
      entry.strapiField === null
        ? "unsupported"
        : entry.dataType.includes("media")
          ? "media"
          : entry.dataType.includes("relation")
            ? "relation"
            : entry.dataType.includes("component")
              ? "component"
              : "scalar",
    required: false,
    localized: false,
    extractionStrategy: entry.dataType.includes("media")
      ? "Explicit embedded-image marker in the labeled field; otherwise manual selection."
      : "Normalized table label, labeled paragraph, or heading followed by its value; AI may supplement only absent fields.",
    validation:
      entry.internalField === "date"
        ? "Real calendar date in YYYY-MM-DD format."
        : entry.internalField === "button"
          ? "HTTP(S) URL, root-relative path, or fragment only."
          : entry.dataType,
    transformation:
      entry.internalField === "defaultSeo.keywords"
        ? "Keyword array to comma-separated Strapi text."
        : entry.internalField === "defaultSeo.metaViewPort"
          ? "Map document spelling to seo.metaViewport."
          : entry.internalField === "authordata"
            ? "Wrap a provided author name in the Authordata component."
            : entry.internalField === "slug"
              ? "Normalize to a lowercase hyphenated UID."
              : "None.",
  }));

/**
 * Real Strapi 5 Article payload allowlist. Media, unresolved relations, and
 * extraction-only fields are intentionally excluded.
 */
export const StrapiArticlePayloadSchema = z
  .object({
    Title: z
      .string()
      .min(1, "Title must not be empty")
      .max(255, "Title must be under 255 characters")
      .nullable()
      .optional(),
    slug: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must be lowercase-hyphenated (e.g. my-article-title)",
      )
      .max(128)
      .nullable()
      .optional(),
    description: z
      .string()
      .max(1000, "Description should be under 1000 chars")
      .nullable()
      .optional(),
    content: z.string().nullable().optional(),
    date: z
      .string()
      .refine(isValidIsoDate, "Date must be a real date in YYYY-MM-DD format")
      .nullable()
      .optional(),
    seo: z
      .object({
        metaTitle: z.string().nullable().optional(),
        metaDescription: z.string().nullable().optional(),
        keywords: z.string().nullable().optional(),
        metaRobots: z.string().nullable().optional(),
        structureData: z
          .union([z.string(), z.record(z.any()), z.array(z.any())])
          .nullable()
          .optional(),
        structuredData: z
          .union([z.string(), z.record(z.any()), z.array(z.any())])
          .nullable()
          .optional(),
        metaViewport: z.string().nullable().optional(),
        canonicalURL: z.string().nullable().optional(),
        shareImage: z
          .union([z.string(), z.array(z.string()), z.record(z.any())])
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    Authordata: z
      .object({ authorName: z.string().optional() })
      .strict()
      .optional(),
    categoryName: z.string().nullable().optional(),
    button: z.object({ link: z.string().optional() }).strict().optional(),
    buttontitle: z.string().nullable().optional(),
    buttonsubtitle: z.string().nullable().optional(),
    time: z.string().nullable().optional(),
  })
  .strict();

export type StrapiArticlePayload = z.infer<typeof StrapiArticlePayloadSchema>;

// Alias for backwards compatibility with existing imports
export const ArticlePayloadSchema = StrapiArticlePayloadSchema;
export type ArticlePayload = StrapiArticlePayload;

/**
 * AI mapping result schema — includes independent document fields,
 * the verified Strapi payload, and mapping metadata.
 */
export const AiMappingResultSchema = z
  .object({
    fields: DocumentFieldsSchema.describe(
      "Field-by-field extracted document values",
    ),
    payload: StrapiArticlePayloadSchema.describe(
      "Constructed Strapi 5 draft payload",
    ),
    fieldStates: FieldStatesSchema,
    missingFields: z
      .array(z.string())
      .describe(
        "Known document fields that were absent. Explicitly empty and unresolved states are tracked separately.",
      ),
    unmappedFields: z.array(
      z.object({ label: z.string(), value: z.string() }).strict(),
    ),
    ambiguities: z
      .array(z.string())
      .describe("Cases where mapping was uncertain; human review recommended"),
    warnings: z.array(z.string()),
    confidence: z
      .enum(["high", "medium", "low"])
      .describe("Overall mapping confidence"),
  })
  .strict();

export type AiMappingResult = z.infer<typeof AiMappingResultSchema>;

export interface ValidationOptions {
  requiredFields?: (keyof StrapiArticlePayload)[];
}

/**
 * Validate an article payload and return errors or the parsed value.
 * Respects required field constraints when specified. Missing optional fields
 * do NOT cause validation failures.
 */
export function validateArticlePayload(
  data: unknown,
  options: ValidationOptions = {},
):
  | {
      success: true;
      data: StrapiArticlePayload;
    }
  | {
      success: false;
      errors: z.ZodIssue[];
    } {
  const result = StrapiArticlePayloadSchema.safeParse(data);
  if (!result.success) {
    return { success: false, errors: result.error.issues };
  }

  const required = options.requiredFields ?? [];
  const missingErrors: z.ZodIssue[] = [];

  for (const field of required) {
    const val = result.data[field];
    if (
      val === undefined ||
      val === null ||
      (typeof val === "string" && val.trim() === "")
    ) {
      missingErrors.push({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `Missing required field: ${String(field)}`,
      });
    }
  }

  if (missingErrors.length > 0) {
    return { success: false, errors: missingErrors };
  }

  return { success: true, data: result.data };
}

/**
 * Safely generate a URL-safe slug from a title string.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 128);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * Build the Strapi 5 REST API draft payload from independently extracted document fields.
 * Missing, explicitly empty, unresolved, and invalid values are omitted so they
 * cannot clear an existing CMS value if this payload is later used as a patch.
 */
export function buildStrapiPayload(
  fields: DocumentFields,
  fieldStates: FieldStates = {},
): StrapiArticlePayload {
  const payload: StrapiArticlePayload = {};
  const canWrite = (key: DocumentFieldKey) =>
    fieldStates[key] === undefined || fieldStates[key].status === "extracted";

  if (canWrite("title") && fields.title?.trim()) {
    payload.Title = fields.title.trim().substring(0, 255);
  }

  if (canWrite("slug") && fields.slug?.trim()) {
    payload.slug = slugify(fields.slug.trim());
  } else if (
    canWrite("title") &&
    payload.Title &&
    (fieldStates.slug === undefined || fieldStates.slug.status === "missing")
  ) {
    payload.slug = slugify(payload.Title);
  }

  if (canWrite("description") && fields.description?.trim()) {
    payload.description = fields.description.trim().substring(0, 1000);
  }

  if (canWrite("content") && fields.content?.trim()) {
    payload.content = fields.content.trim();
  }

  if (canWrite("date") && fields.date && isValidIsoDate(fields.date)) {
    payload.date = fields.date;
  }
  if (canWrite("authordata") && fields.authordata?.trim()) {
    payload.Authordata = { authorName: fields.authordata.trim() };
  }
  if (canWrite("categoryname") && fields.categoryname?.trim()) {
    payload.categoryName = fields.categoryname.trim();
  }
  if (canWrite("button") && fields.button && isSafeButtonLink(fields.button)) {
    payload.button = { link: fields.button.trim() };
  }
  if (canWrite("buttontitle") && fields.buttontitle?.trim()) {
    payload.buttontitle = fields.buttontitle.trim();
  }
  if (canWrite("buttonsubtitle") && fields.buttonsubtitle?.trim()) {
    payload.buttonsubtitle = fields.buttonsubtitle.trim();
  }
  if (canWrite("time") && fields.time?.trim()) {
    payload.time = fields.time.trim();
  }

  const seo = fields.defaultSeo;
  const seoPayload: NonNullable<StrapiArticlePayload["seo"]> = {};
  const addSeo = (
    key: keyof NonNullable<DocumentFields["defaultSeo"]>,
    target: keyof typeof seoPayload,
  ) => {
    const stateKey = `defaultSeo.${key}` as DocumentFieldKey;
    const value = seo?.[key];
    if (canWrite(stateKey) && typeof value === "string" && value.trim()) {
      seoPayload[target] = value.trim();
    }
  };
  addSeo("metaTitle", "metaTitle");
  addSeo("metaDescription", "metaDescription");
  addSeo("metaRobots", "metaRobots");

  const structureDataValue =
    seo?.structureData ?? seo?.structuredData ?? null;
  if (
    canWrite("defaultSeo.structureData") &&
    typeof structureDataValue === "string" &&
    structureDataValue.trim()
  ) {
    seoPayload.structureData = structureDataValue.trim();
  }
  if (
    canWrite("defaultSeo.structuredData") &&
    typeof structureDataValue === "string" &&
    structureDataValue.trim()
  ) {
    seoPayload.structuredData = structureDataValue.trim();
  }

  addSeo("metaViewPort", "metaViewport");
  addSeo("canonicalURL", "canonicalURL");
  const shareImageValue = seo?.shareImage;
  if (
    canWrite("defaultSeo.shareImage") &&
    typeof shareImageValue === "string" &&
    shareImageValue.trim()
  ) {
    seoPayload.shareImage = shareImageValue.trim();
  }
  if (canWrite("defaultSeo.keywords") && seo?.keywords?.length) {
    seoPayload.keywords = seo.keywords.join(", ");
  }
  if (Object.keys(seoPayload).length > 0) {
    payload.seo = seoPayload;
  }

  return payload;
}

function isSafeButtonLink(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^https?:\/\/\S+$/i.test(trimmed) ||
    /^\/[^/\s][^\s]*$/.test(trimmed) ||
    /^#[^\s]+$/.test(trimmed)
  );
}
/**
 * JSON Schema for Gemini / OpenAI Structured Outputs.
 * Defines the contract where EVERY field is extracted independently.
 */
export const AI_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "object",
      properties: {
        title: {
          type: ["string", "null"],
          description: "Article title only, max 255 chars",
        },
        description: {
          type: ["string", "null"],
          description: "Short summary / abstract, max 1000 chars",
        },
        slug: {
          type: ["string", "null"],
          description: "URL slug: lowercase, hyphens only",
        },
        cover: {
          type: ["string", "null"],
          description:
            "Explicit embedded-image marker only; do not invent media IDs or treat placeholder text as an image.",
        },
        defaultSeo: {
          type: ["object", "null"],
          properties: {
            metaTitle: { type: ["string", "null"] },
            metaDescription: { type: ["string", "null"] },
            keywords: { type: "array", items: { type: "string" } },
            metaRobots: { type: ["string", "null"] },
            structureData: {
              type: ["string", "object", "array", "number", "boolean", "null"],
              description:
                "Actual Strapi JSON field name. Accept both structureData and legacy structuredData variants.",
            },
            structuredData: {
              type: ["string", "object", "array", "number", "boolean", "null"],
              description: "Legacy alias used by older extraction prompts.",
            },
            metaViewPort: { type: ["string", "null"] },
            canonicalURL: { type: ["string", "null"] },
            shareImage: {
              type: ["string", "array", "object", "null"],
              description:
                "Extract only a supplied asset reference; never invent a media ID.",
            },
          },
          required: ["keywords"],
        },
        content: {
          type: ["string", "null"],
          description:
            "MAIN ARTICLE BODY ONLY. Do NOT include title, description, SEO, author, date, categories, buttons, FAQs, or forms.",
        },
        date: { type: ["string", "null"], description: "Article date" },
        authordata: {
          type: ["string", "null"],
          description: "Author name or details",
        },
        categoryname: {
          type: ["string", "null"],
          description: "Category name",
        },
        contentnew: {
          type: ["string", "array", "object", "null"],
          description: "Specific new content block if present (legacy key)",
        },
        contentNew: {
          type: ["string", "array", "object", "null"],
          description: "Repeatable contentNew component values if present",
        },
        button: { type: ["string", "null"], description: "Button text" },
        buttontitle: { type: ["string", "null"], description: "Button title" },
        buttonsubtitle: {
          type: ["string", "null"],
          description: "Button subtitle",
        },
        blogcategories: {
          type: ["string", "null"],
          description: "Blog categories",
        },
        time: {
          type: ["string", "null"],
          description: "Reading time or duration",
        },
        faqsection: { type: ["string", "null"], description: "FAQ content" },
        formsection: {
          type: ["string", "null"],
          description: "Form configuration or text",
        },
        popularityname: {
          type: ["string", "null"],
          description: "Popularity tag",
        },
      },
      required: [
        "title",
        "description",
        "slug",
        "cover",
        "defaultSeo",
        "content",
        "date",
        "authordata",
        "categoryname",
        "contentnew",
        "button",
        "buttontitle",
        "buttonsubtitle",
        "blogcategories",
        "time",
        "faqsection",
        "formsection",
        "popularityname",
      ],
    },
    missingFields: {
      type: "array",
      items: { type: "string" },
      description:
        "Field names that could not be mapped because content was absent",
    },
    ambiguities: {
      type: "array",
      items: { type: "string" },
      description: "Mappings that were uncertain; requires human review",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Overall confidence in the mapping",
    },
  },
  required: ["fields", "missingFields", "ambiguities", "confidence"],
};
