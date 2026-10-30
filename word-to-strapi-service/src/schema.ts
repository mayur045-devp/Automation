import { z } from "zod";
import { SchemaType } from "@google/generative-ai";
import type { ResponseSchema, Schema } from "@google/generative-ai";

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
    structuredData: z.string().nullable().optional(),
    metaViewPort: z.string().nullable().optional(),
    canonicalURL: z.string().nullable().optional(),
    shareImage: z.string().nullable().optional(),
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
export const ContentNewEntrySchema = z
  .object({
    title: z.string().nullable().optional(),
    content: z
      .union([
        z.string(),
        z.array(z.record(z.any())),
        z.record(z.any()),
        z.null(),
      ])
      .optional(),
  })
  .strict();

export const StrapiTextNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  code: z.boolean().optional(),
});

export const StrapiLinkNodeSchema = z.object({
  type: z.literal("link"),
  url: z.string(),
  children: z.array(StrapiTextNodeSchema).min(1, "Link node must contain at least one text child"),
});

export const StrapiInlineNodeSchema = z.union([StrapiTextNodeSchema, StrapiLinkNodeSchema]);

export const StrapiListItemNodeSchema = z.object({
  type: z.literal("list-item"),
  children: z.array(StrapiInlineNodeSchema).min(1, "List item must contain at least one inline child"),
});

export const StrapiBlockNodeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paragraph"),
    children: z.array(StrapiInlineNodeSchema).min(1, "Paragraph block must contain at least one child"),
  }),
  z.object({
    type: z.literal("heading"),
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    children: z.array(StrapiInlineNodeSchema).min(1, "Heading block must contain at least one child"),
  }),
  z.object({
    type: z.literal("list"),
    format: z.enum(["ordered", "unordered"]),
    children: z.array(StrapiListItemNodeSchema).min(1, "List block must contain at least one list item"),
  }),
  z.object({
    type: z.literal("quote"),
    children: z.array(StrapiInlineNodeSchema).min(1, "Quote block must contain at least one child"),
  }),
  z.object({
    type: z.literal("code"),
    children: z.array(StrapiTextNodeSchema).min(1, "Code block must contain text child"),
  }),
  z.object({
    type: z.literal("image"),
    image: z.record(z.any()),
    children: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  }),
]);

export const StrapiBlocksSchema = z.array(StrapiBlockNodeSchema);
export type StrapiBlockNode = z.infer<typeof StrapiBlockNodeSchema>;

export function validateStrapiBlocks(blocks: unknown): { valid: boolean; errors: string[] } {
  if (!Array.isArray(blocks)) {
    return { valid: false, errors: ["Blocks payload must be an array of block objects."] };
  }
  if (blocks.length === 0) {
    return { valid: false, errors: ["Blocks array must contain at least one block element."] };
  }
  const parsed = StrapiBlocksSchema.safeParse(blocks);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "blocks"}: ${issue.message}`),
    };
  }
  return { valid: true, errors: [] };
}

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
      .union([
        z.string(),
        z.array(ContentNewEntrySchema),
        ContentNewEntrySchema,
        z.null(),
      ])
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
  "defaultSeo.structuredData",
  "defaultSeo.metaViewPort",
  "defaultSeo.canonicalURL",
  "defaultSeo.shareImage",
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
    label: "Default SEO / structuredData",
    aliases: ["structuredData", "Default SEO structuredData"],
    internalField: "defaultSeo.structuredData",
    strapiField: "seo.structuredData",
    dataType: "component string",
    automatic: true,
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
    aliases: ["shareImage"],
    internalField: "defaultSeo.shareImage",
    strapiField: null,
    dataType: "media",
    automatic: false,
    note: "The component has metaImage and metaSocial, but no verified shareImage mapping.",
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
    aliases: ["contentNew"],
    internalField: "contentnew",
    strapiField: "contentNew",
    dataType: "component with Blocks",
    automatic: true,
    note: "Plain text is not converted into an invented Blocks structure.",
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
export const ContentNewComponentEntrySchema = z
  .object({
    title: z.string().nullable().optional(),
    content: z.string().min(1, "Component content must not be empty"),
  })
  .strict();

export type ContentNewComponentEntry = z.infer<typeof ContentNewComponentEntrySchema>;

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
        structuredData: z.string().nullable().optional(),
        structureData: z.string().nullable().optional(),
        metaViewport: z.string().nullable().optional(),
        canonicalURL: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    Authordata: z
      .object({ authorName: z.string().optional() })
      .strict()
      .optional(),
    categoryName: z.string().nullable().optional(),
    contentNew: z
      .array(ContentNewComponentEntrySchema)
      .nullable()
      .optional(),
    button: z
      .object({
        name: z.string().optional(),
        link: z.string().optional(),
      })
      .strict()
      .optional(),
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

  if (canWrite("contentnew")) {
    const contentNewItems = normalizeContentNewValue(fields.contentnew);
    if (contentNewItems.length > 0) {
      payload.contentNew = contentNewItems as any;
    }
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
  addSeo("structuredData", "structuredData");
  addSeo("metaViewPort", "metaViewport");
  addSeo("canonicalURL", "canonicalURL");
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

function parseJsonLike(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parseJsonLike(parsed) : parsed;
    } catch {
      return value;
    }
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeBlockNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const normalized: Record<string, unknown> = { ...value };
  if (typeof normalized.type === "string") {
    normalized.type = normalized.type.replace(/^['"]+|['"]+$/g, "");
  }
  if (Array.isArray(normalized.children)) {
    normalized.children = normalized.children
      .map((child) => {
        if (!child || typeof child !== "object" || Array.isArray(child)) {
          return child;
        }
        const next = { ...child } as Record<string, unknown>;
        if (typeof next.type === "string") {
          next.type = next.type.replace(/^['"]+|['"]+$/g, "");
        }
        if (typeof next.text === "string") {
          next.text = next.text.replace(/^['"]+|['"]+$/g, "");
        }
        return next;
      })
      .filter((child) => child !== undefined && child !== null);
  }
  if (typeof normalized.text === "string") {
    normalized.text = normalized.text.replace(/^['"]+|['"]+$/g, "");
  }
  return normalized;
}

export function parseMarkdownHeadingSections(
  text: string,
): Array<{ title: string; content: string }> {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentTitle) {
      const content = currentLines.join("\n").trim();
      if (content) {
        sections.push({ title: currentTitle, content });
      }
      currentLines = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^(#{1,3})\s+(.*)$/);
    if (match) {
      flush();
      currentTitle = match[2].trim();
    } else if (currentTitle) {
      currentLines.push(rawLine);
    }
  }

  flush();
  return sections;
}

export function parseSectionsFromText(
  text: string,
): Array<{ title: string; content: string }> {
  if (!text || !text.trim()) return [];

  const sections: Array<{ title: string; content: string }> = [];

  const titleMarkerRegex = /(?:^|\r?\n|\*\*)\s*(?:Title|Section Title)\s*[:—–-]\s*/gi;
  const matches: Array<{ index: number; markerLength: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = titleMarkerRegex.exec(text)) !== null) {
    matches.push({ index: m.index, markerLength: m[0].length });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const startIndex = matches[i].index + matches[i].markerLength;
      const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const rawSection = text.substring(startIndex, endIndex).trim();

      const contentMarkerMatch = rawSection.match(
        /^(.*?)(?:\*\*|\r?\n)?\s*(?:\*\*)?\s*Content\s*[:—–-]\s*(?:\*\*)?([\s\S]*)$/i,
      );

      let title = "";
      let body = "";

      if (contentMarkerMatch) {
        title = contentMarkerMatch[1].replace(/^\*\*|\*\*$/g, "").trim();
        body = contentMarkerMatch[2].replace(/^\*\*|\*\*$/g, "").trim();
      } else {
        const firstLineEnd = rawSection.search(/\r?\n/);
        if (firstLineEnd !== -1) {
          title = rawSection.substring(0, firstLineEnd).replace(/^\*\*|\*\*$/g, "").trim();
          body = rawSection.substring(firstLineEnd).replace(/^\*\*|\*\*$/g, "").trim();
        } else {
          const closingBold = rawSection.indexOf("**");
          if (closingBold !== -1) {
            title = rawSection.substring(0, closingBold).trim();
            body = rawSection.substring(closingBold + 2).trim();
          } else {
            title = rawSection.trim();
            body = "";
          }
        }
      }

      if (title && (body || matches.length > 1)) {
        sections.push({ title, content: body });
      }
    }

    if (sections.length > 0) {
      return sections;
    }
  }

  return parseMarkdownHeadingSections(text);
}

function parseInlineMarkdown(text: string): Array<Record<string, unknown>> {
  if (!text) return [];
  const children: Array<Record<string, unknown>> = [];
  const tokenRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+|\/[^\s\)]+|#[^\s\)]+)\)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      children.push({
        type: "text",
        text: text.substring(lastIndex, match.index),
      });
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      children.push({
        type: "link",
        url: match[2],
        children: [{ type: "text", text: match[1] }],
      });
    } else if (match[3] !== undefined) {
      children.push({
        type: "text",
        text: match[3],
        bold: true,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    children.push({
      type: "text",
      text: text.substring(lastIndex),
    });
  }

  return children.length > 0 ? children : [{ type: "text", text }];
}

function normalizeContentNewValue(
  value: unknown,
): Array<{ title?: string; content: string }> {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const entries: Array<{ title?: string; content: string }> = [];
  const queue: unknown[] = Array.isArray(value) ? value : [value];

  for (const item of queue) {
    if (typeof item === "string") {
      const parsed = parseJsonLike(item);
      if (parsed !== item) {
        entries.push(...normalizeContentNewValue(parsed));
        continue;
      }

      const detected = parseSectionsFromText(item);
      if (detected.length > 0) {
        for (const sec of detected) {
          if (sec.content.trim()) {
            entries.push({
              title: sec.title,
              content: sec.content,
            });
          }
        }
        continue;
      }

      if (item.trim()) {
        entries.push({ content: item });
      }
      continue;
    }

    if (item && typeof item === "object") {
      if (Array.isArray(item)) {
        entries.push(...normalizeContentNewValue(item));
        continue;
      }

      const record = item as Record<string, unknown>;
      let title = typeof record.title === "string" ? record.title.trim() : undefined;
      const blockValue =
        record.content !== undefined
          ? record.content
          : Array.isArray(record.children)
            ? record.children
            : typeof record.text === "string" || record.type !== undefined
              ? record
              : undefined;

      if (!title && typeof blockValue === "string") {
        const detected = parseSectionsFromText(blockValue);
        if (detected.length > 0) {
          for (const sec of detected) {
            if (sec.content.trim()) {
              entries.push({
                title: sec.title,
                content: sec.content,
              });
            }
          }
          continue;
        }
      }

      if (blockValue === undefined && !title) {
        continue;
      }

      const content = typeof blockValue === "string"
        ? blockValue
        : Array.isArray(blockValue)
          ? blockValue.map((node) => contentNewNodeToText(node)).filter(Boolean).join("\n\n")
          : blockValue && typeof blockValue === "object"
            ? contentNewNodeToText(blockValue)
            : "";

      if (content.trim() || title) {
        entries.push({
          ...(title ? { title } : {}),
          content,
        });
      }
    }
  }

  return entries.filter((entry) => entry.content.trim().length > 0);
}

function contentNewNodeToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentNewNodeToText).filter(Boolean).join("\n\n");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.children)) return contentNewNodeToText(node.children);
  return "";
}

/**
 * Convert plain text or markdown formatted text into Strapi 5 Blocks format.
 */
export function textToBlocks(text: string): Array<Record<string, unknown>> {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const blocks: Array<Record<string, unknown>> = [];
  let currentParagraphLines: string[] = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const pText = currentParagraphLines.join(" ").trim();
      if (pText) {
        blocks.push({
          type: "paragraph",
          children: parseInlineMarkdown(pText),
        });
      }
      currentParagraphLines = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const rawLevel = headingMatch[1].length;
      const level = Math.min(6, Math.max(1, rawLevel));
      blocks.push({
        type: "heading",
        level,
        children: [{ type: "text", text: headingMatch[2].trim() }],
      });
      continue;
    }

    const listMatch =
      line.match(/^[-*]\s+(.*)$/) || line.match(/^\d+[\.\)]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      const format = line.match(/^[-*]/) ? "unordered" : "ordered";
      const lastBlock = blocks[blocks.length - 1];
      const itemNode = {
        type: "list-item",
        children: parseInlineMarkdown(listMatch[1].trim()),
      };
      if (lastBlock && lastBlock.type === "list" && lastBlock.format === format) {
        (lastBlock.children as any[]).push(itemNode);
      } else {
        blocks.push({
          type: "list",
          format,
          children: [itemNode],
        });
      }
      continue;
    }

    currentParagraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Converts any standard JSON Schema or partial schema into a valid Gemini API ResponseSchema.
 * Replaces array types like ["string", "null"] with { type: SchemaType.STRING, nullable: true }.
 */
export function toGeminiSchema(schema: any): ResponseSchema {
  if (!schema || typeof schema !== 'object') {
    return { type: SchemaType.STRING, nullable: true };
  }

  const result: any = {};

  if (Array.isArray(schema.type)) {
    const isNullable = schema.type.includes('null');
    const mainType = schema.type.find((t: any) => t !== 'null') || 'string';
    result.type = mapToSchemaType(mainType);
    if (isNullable) result.nullable = true;
  } else if (typeof schema.type === 'string') {
    result.type = mapToSchemaType(schema.type);
    if (schema.nullable === true) result.nullable = true;
  } else if (schema.properties) {
    result.type = SchemaType.OBJECT;
  } else {
    result.type = SchemaType.STRING;
  }

  if (schema.description) result.description = String(schema.description);
  if (schema.nullable === true) result.nullable = true;
  if (Array.isArray(schema.enum)) result.enum = schema.enum.map(String);
  if (Array.isArray(schema.required)) result.required = [...schema.required];

  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = toGeminiSchema(prop);
    }
  }

  if (schema.items) {
    result.items = toGeminiSchema(schema.items);
  }

  return result as ResponseSchema;
}

function mapToSchemaType(typeStr: string): SchemaType {
  const lower = String(typeStr).toLowerCase();
  switch (lower) {
    case 'string':
      return SchemaType.STRING;
    case 'number':
      return SchemaType.NUMBER;
    case 'integer':
      return SchemaType.INTEGER;
    case 'boolean':
      return SchemaType.BOOLEAN;
    case 'array':
      return SchemaType.ARRAY;
    case 'object':
      return SchemaType.OBJECT;
    default:
      return SchemaType.STRING;
  }
}

export const AI_OUTPUT_GEMINI_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    fields: {
      type: SchemaType.OBJECT,
      properties: {
        title: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Article title only, max 255 chars",
        },
        description: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Short summary / abstract, max 1000 chars",
        },
        slug: {
          type: SchemaType.STRING,
          nullable: true,
          description: "URL slug: lowercase, hyphens only",
        },
        cover: {
          type: SchemaType.STRING,
          nullable: true,
          description:
            "Explicit embedded-image marker only; do not invent media IDs or treat placeholder text as an image.",
        },
        defaultSeo: {
          type: SchemaType.OBJECT,
          nullable: true,
          properties: {
            metaTitle: { type: SchemaType.STRING, nullable: true },
            metaDescription: { type: SchemaType.STRING, nullable: true },
            keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            metaRobots: { type: SchemaType.STRING, nullable: true },
            structuredData: { type: SchemaType.STRING, nullable: true },
            metaViewPort: { type: SchemaType.STRING, nullable: true },
            canonicalURL: { type: SchemaType.STRING, nullable: true },
            shareImage: {
              type: SchemaType.STRING,
              nullable: true,
              description:
                "Extract only a supplied asset reference; never invent a media ID.",
            },
          },
          required: ["keywords"],
        },
        content: {
          type: SchemaType.STRING,
          nullable: true,
          description:
            "MAIN INTRODUCTORY ARTICLE BODY ONLY. If the document has repeatable section headings or Title/Content pairs, place those repeatable sections in 'contentnew' and put only the introductory blog paragraphs here. Do NOT include title, description, SEO, author, date, categories, buttons, FAQs, or forms.",
        },
        date: { type: SchemaType.STRING, nullable: true, description: "Article date" },
        authordata: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Author name or details",
        },
        categoryname: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Category name",
        },
        contentnew: {
          type: SchemaType.ARRAY,
          nullable: true,
          description:
            "Repeatable content sections (Strapi contentNew component). Extract each genuine section heading or explicit Title: / Content: pair as an item with a 'title' string and its associated 'content' string.",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: {
                type: SchemaType.STRING,
                description: "Section heading or title (e.g. 'Choosing the lab')",
              },
              content: {
                type: SchemaType.STRING,
                description:
                  "All paragraphs, lists, and subheadings belonging to this section.",
              },
            },
            required: ["title", "content"],
          },
        },
        button: { type: SchemaType.STRING, nullable: true, description: "Button text or link" },
        buttontitle: { type: SchemaType.STRING, nullable: true, description: "Button title" },
        buttonsubtitle: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Button subtitle",
        },
        blogcategories: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Blog categories",
        },
        time: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Reading time or duration",
        },
        faqsection: { type: SchemaType.STRING, nullable: true, description: "FAQ content" },
        formsection: {
          type: SchemaType.STRING,
          nullable: true,
          description: "Form configuration or text",
        },
        popularityname: {
          type: SchemaType.STRING,
          nullable: true,
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
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        "Field names that could not be mapped because content was absent",
    },
    ambiguities: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Mappings that were uncertain; requires human review",
    },
    confidence: {
      type: SchemaType.STRING,
      enum: ["high", "medium", "low"],
      description: "Overall confidence in the mapping",
    },
  },
  required: ["fields", "missingFields", "ambiguities", "confidence"],
};

export const AI_OUTPUT_JSON_SCHEMA = AI_OUTPUT_GEMINI_SCHEMA;
