import { z } from 'zod';

/**
 * SEO Component Schema — represents defaultSeo component in Strapi / document metadata.
 * Contains: metaTitle, metaDescription, keywords, metaRobots, structuredData, metaViewPort, canonicalURL, shareImage.
 */
export const SeoComponentSchema = z.object({
  metaTitle: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  keywords: z.array(z.string()).default([]),
  metaRobots: z.string().nullable().optional(),
  structuredData: z.string().nullable().optional(),
  metaViewPort: z.string().nullable().optional(),
  canonicalURL: z.string().nullable().optional(),
  shareImage: z.string().nullable().optional(),
});

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
export const DocumentFieldsSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  defaultSeo: SeoComponentSchema.nullable().optional(),
  content: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  authordata: z.string().nullable().optional(),
  categoryname: z.string().nullable().optional(),
  contentnew: z.string().nullable().optional(),
  button: z.string().nullable().optional(),
  buttontitle: z.string().nullable().optional(),
  buttonsubtitle: z.string().nullable().optional(),
  blogcategories: z.union([z.array(z.string()), z.string()]).nullable().optional(),
  time: z.string().nullable().optional(),
  faqsection: z.union([z.array(FaqItemSchema), z.array(z.any()), z.string()]).nullable().optional(),
  formsection: z.union([z.record(z.any()), z.string()]).nullable().optional(),
  popularityname: z.string().nullable().optional(),
});

export type DocumentFields = z.infer<typeof DocumentFieldsSchema>;

/**
 * Real Strapi 5 Article content type payload schema.
 * Derived from inspected `my-strapi/src/api/article/content-types/article/schema.json`:
 * - Title (string)
 * - slug (uid)
 * - description (text)
 * - content (richtext)
 * Note: coverImage is a media field uploaded separately and attached by ID.
 */
export const StrapiArticlePayloadSchema = z.object({
  Title: z
    .string()
    .min(1, 'Title must not be empty')
    .max(255, 'Title must be under 255 characters')
    .nullable()
    .optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase-hyphenated (e.g. my-article-title)')
    .max(128)
    .nullable()
    .optional(),
  description: z.string().max(1000, 'Description should be under 1000 chars').nullable().optional(),
  content: z.string().nullable().optional(),
});

export type StrapiArticlePayload = z.infer<typeof StrapiArticlePayloadSchema>;

// Alias for backwards compatibility with existing imports
export const ArticlePayloadSchema = StrapiArticlePayloadSchema;
export type ArticlePayload = StrapiArticlePayload;

/**
 * AI mapping result schema — includes independent document fields,
 * the verified Strapi payload, and mapping metadata.
 */
export const AiMappingResultSchema = z.object({
  fields: DocumentFieldsSchema.describe('Field-by-field extracted document values'),
  payload: StrapiArticlePayloadSchema.describe('Constructed Strapi 5 draft payload'),
  missingFields: z
    .array(z.string())
    .describe('Fields that were absent in the document or schema'),
  ambiguities: z
    .array(z.string())
    .describe('Cases where mapping was uncertain; human review recommended'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Overall mapping confidence'),
});

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
  options: ValidationOptions = {}
): {
  success: true;
  data: StrapiArticlePayload;
} | {
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
    const val = (result.data as any)[field];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
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
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 128);
}

/**
 * Build the Strapi 5 REST API draft payload from independently extracted document fields.
 * Follows inspected Strapi 5 schema:
 * - Uses exact attribute name `Title` (PascalCase in schema.json).
 * - Maps `description`, `slug`, `content`.
 * - Leaves optional empty fields as null or omitted.
 * - NEVER dumps unmapped fields (authordata, faqsection, defaultSeo, buttons) into `content`.
 */
export function buildStrapiPayload(fields: DocumentFields): StrapiArticlePayload {
  const payload: StrapiArticlePayload = {};

  // Title: use explicit title, fallback to null if empty
  if (fields.title && fields.title.trim().length > 0) {
    payload.Title = fields.title.trim().substring(0, 255);
  } else {
    payload.Title = null;
  }

  // Slug: use explicit slug or safely derive from title
  if (fields.slug && fields.slug.trim().length > 0) {
    payload.slug = slugify(fields.slug.trim());
  } else if (payload.Title) {
    payload.slug = slugify(payload.Title);
  } else {
    payload.slug = null;
  }

  // Description: use explicit description, fallback to null
  if (fields.description && fields.description.trim().length > 0) {
    payload.description = fields.description.trim().substring(0, 1000);
  } else {
    payload.description = null;
  }

  // Content: ONLY the main article body. Never concatenate other fields!
  if (fields.content && fields.content.trim().length > 0) {
    payload.content = fields.content.trim();
  } else {
    payload.content = null;
  }

  return payload;
}

/**
 * JSON Schema for Gemini / OpenAI Structured Outputs.
 * Defines the contract where EVERY field is extracted independently.
 */
export const AI_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'object',
      properties: {
        title: { type: ['string', 'null'], description: 'Article title only, max 255 chars' },
        description: { type: ['string', 'null'], description: 'Short summary / abstract, max 1000 chars' },
        slug: { type: ['string', 'null'], description: 'URL slug: lowercase, hyphens only' },
        cover: { type: ['string', 'null'], description: 'Media asset identifier if present, else null. Text placeholders are null.' },
        defaultSeo: {
          type: ['object', 'null'],
          properties: {
            metaTitle: { type: ['string', 'null'] },
            metaDescription: { type: ['string', 'null'] },
            keywords: { type: 'array', items: { type: 'string' } },
            metaRobots: { type: ['string', 'null'] },
            structuredData: { type: ['string', 'null'] },
            metaViewPort: { type: ['string', 'null'] },
            canonicalURL: { type: ['string', 'null'] },
            shareImage: { type: ['string', 'null'] },
          },
          required: ['keywords'],
        },
        content: {
          type: ['string', 'null'],
          description: 'MAIN ARTICLE BODY ONLY. Do NOT include title, description, SEO, author, date, categories, buttons, FAQs, or forms.',
        },
        date: { type: ['string', 'null'], description: 'Article date' },
        authordata: { type: ['string', 'null'], description: 'Author name or details' },
        categoryname: { type: ['string', 'null'], description: 'Category name' },
        contentnew: { type: ['string', 'null'], description: 'Specific new content block if present' },
        button: { type: ['string', 'null'], description: 'Button text' },
        buttontitle: { type: ['string', 'null'], description: 'Button title' },
        buttonsubtitle: { type: ['string', 'null'], description: 'Button subtitle' },
        blogcategories: { type: ['string', 'null'], description: 'Blog categories' },
        time: { type: ['string', 'null'], description: 'Reading time or duration' },
        faqsection: { type: ['string', 'null'], description: 'FAQ content' },
        formsection: { type: ['string', 'null'], description: 'Form configuration or text' },
        popularityname: { type: ['string', 'null'], description: 'Popularity tag' },
      },
      required: [
        'title',
        'description',
        'slug',
        'cover',
        'defaultSeo',
        'content',
        'date',
        'authordata',
        'categoryname',
        'contentnew',
        'button',
        'buttontitle',
        'buttonsubtitle',
        'blogcategories',
        'time',
        'faqsection',
        'formsection',
        'popularityname',
      ],
    },
    missingFields: {
      type: 'array',
      items: { type: 'string' },
      description: 'Field names that could not be mapped because content was absent',
    },
    ambiguities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Mappings that were uncertain; requires human review',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'Overall confidence in the mapping',
    },
  },
  required: ['fields', 'missingFields', 'ambiguities', 'confidence'],
};
