import { z } from 'zod';
import { validateArticlePayload, StrapiArticlePayloadSchema } from './schema';
import type { DynamicImportCollection } from './dynamicCollections';

export interface ImportField {
  name: string;
  type: string;
  required: boolean;
  supported: boolean;
  multiple?: boolean;
  allowedTypes?: string[];
  sourceField?: string;
  note?: string;
}

export interface ImportCollection {
  uid: string;
  displayName: string;
  apiName: string;
  kind?: 'collectionType' | 'singleType';
  graphqlFields: readonly string[];
  draftAndPublish: boolean;
  duplicateField?: string;
  mapper: 'article' | 'scalar';
  fields: readonly ImportField[];
  dynamic?: boolean;
}

const VERIFIED_COLLECTIONS: readonly ImportCollection[] = [
  {
    uid: 'api::article.article',
    displayName: 'Articles',
    apiName: 'articles',
    kind: 'collectionType',
    graphqlFields: ['articles'],
    draftAndPublish: true,
    duplicateField: 'Title',
    mapper: 'article',
    fields: [
      { name: 'Title', type: 'string', required: false, supported: true, sourceField: 'title' },
      { name: 'slug', type: 'uid', required: false, supported: true, sourceField: 'slug' },
      { name: 'description', type: 'text', required: false, supported: true, sourceField: 'description' },
      { name: 'content', type: 'richtext', required: false, supported: true, sourceField: 'content' },
      { name: 'date', type: 'date', required: false, supported: true, sourceField: 'date' },
      { name: 'seo', type: 'component', required: false, supported: true, note: 'Supported through the verified SEO component mapping.' },
      { name: 'coverImage', type: 'media', required: false, supported: true, multiple: false, allowedTypes: ['images'], sourceField: 'cover', note: 'Only an image explicitly referenced in the document Cover field is uploaded.' },
      { name: 'Authordata', type: 'component', required: false, supported: true, note: 'Only the verified authorName component value is mapped.' },
      { name: 'button', type: 'component', required: false, supported: true, note: 'Only the verified link component value is mapped.' },
      { name: 'categoryName', type: 'string', required: false, supported: true, sourceField: 'categoryname' },
      { name: 'buttontitle', type: 'string', required: false, supported: true, sourceField: 'buttontitle' },
      { name: 'buttonsubtitle', type: 'string', required: false, supported: true, sourceField: 'buttonsubtitle' },
      { name: 'time', type: 'string', required: false, supported: true, sourceField: 'time' },
      { name: 'tital_blog_category', type: 'relation', required: false, supported: false, note: 'Relations require explicit resolution; document text is never treated as an ID.' },
      { name: 'contentNew', type: 'component', required: false, supported: true, sourceField: 'contentnew', note: 'Repeatable component entries with title and plain text content.' },
      { name: 'polldata', type: 'component', required: false, supported: false },
      { name: 'Quizedata', type: 'component', required: false, supported: false },
    ],
  },
  {
    uid: 'api::blog.blog',
    displayName: 'Blog',
    apiName: 'blogs',
    kind: 'collectionType',
    graphqlFields: ['blog', 'blogs'],
    draftAndPublish: true,
    duplicateField: 'title',
    mapper: 'scalar',
    fields: [
      { name: 'title', type: 'string', required: false, supported: true, sourceField: 'title' },
      { name: 'description', type: 'text', required: false, supported: true, sourceField: 'description' },
      { name: 'content', type: 'text', required: false, supported: true, sourceField: 'content' },
    ],
  },
];

const DEFAULT_COLLECTION_IDS = ['api::article.article', 'api::blog.blog'];

// In-memory cache for dynamic collections
let dynamicCollectionsCache: ImportCollection[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Convert a DynamicImportCollection to an ImportCollection (for compatibility).
 */
function dynamicToImport(col: DynamicImportCollection): ImportCollection {
  return {
    uid: col.uid,
    displayName: col.displayName,
    apiName: col.apiName,
    kind: col.kind,
    graphqlFields: col.graphqlFields,
    draftAndPublish: col.draftAndPublish,
    duplicateField: col.duplicateField,
    mapper: col.mapper,
    fields: col.fields.map((field) => ({ ...field })),
    dynamic: col.dynamic,
  };
}

/**
 * Set dynamic collections in cache (called from the refresh endpoint).
 */
export function setDynamicCollectionsCache(collections: DynamicImportCollection[]): void {
  dynamicCollectionsCache = collections.map(dynamicToImport);
  cacheTimestamp = Date.now();
}

/**
 * Clear the dynamic collections cache, forcing next request to re-fetch.
 */
export function clearDynamicCollectionsCache(): void {
  dynamicCollectionsCache = null;
  cacheTimestamp = 0;
}

/**
 * Get the effective collections list. A live list is authoritative; the
 * verified registry is used only when live discovery is unavailable or stale.
 */
export function getImportableCollections(): ImportCollection[] {
  // Determine which UIDs to include from env config
  const configuredIds = process.env.STRAPI_IMPORT_COLLECTIONS
    ?.split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
  const allowedIds = configuredIds?.length ? configuredIds : null;

  // If we have dynamic cache and it's not stale, use it
  if (dynamicCollectionsCache && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    const result = dynamicCollectionsCache;
    if (!allowedIds) return result;
    return result.filter((c) => allowedIds.includes(c.uid));
  }

  // Fall back to static
  const staticList = [...VERIFIED_COLLECTIONS];
  if (!allowedIds) return staticList;
  return staticList.filter((c) => allowedIds.includes(c.uid));
}

/**
 * Merge dynamic collections with the static list.
 * Dynamic overrides static by UID. Static fallback preserved.
 */
function mergeDynamic(dynamic: ImportCollection[]): ImportCollection[] {
  return dynamic.map((col) => col.uid === 'api::article.article'
    ? { ...col, mapper: 'article' }
    : col);
}

export function getImportCollection(uid: unknown): ImportCollection | undefined {
  if (typeof uid !== 'string') return undefined;
  return getImportableCollections().find((collection) => collection.uid === uid);
}

export function validateConnectionOrigin(value: unknown, configuredStrapiUrl: string): boolean {
  if (typeof value !== 'string') return false;
  try {
    const connected = new URL(value);
    const configured = new URL(configuredStrapiUrl);
    return (
      (connected.protocol === 'http:' || connected.protocol === 'https:') &&
      connected.origin === value &&
      connected.origin === configured.origin
    );
  } catch {
    return false;
  }
}

export function validateImportPayload(
  collection: ImportCollection,
  payload: unknown,
): { success: true; data: Record<string, unknown> } | { success: false; errors: string[] } {
  if (collection.mapper === 'article') {
    if (!isRecord(payload)) return { success: false, errors: ['Payload must be an object.'] };
    const articleKeys = new Set(Object.keys(StrapiArticlePayloadSchema.shape));
    const extraFields = Object.keys(payload).filter((name) => !articleKeys.has(name));
    const extraDescriptors = extraFields.map((name) =>
      collection.fields.find((field) => field.name === name && field.supported && field.type !== 'media'));
    const unknownFields = extraFields.filter((_name, index) => !extraDescriptors[index]);
    if (unknownFields.length > 0) {
      return {
        success: false,
        errors: unknownFields.map((name) => {
          const proposedType = inferTypeName(payload[name]);
          return `Unsupported field: ${name} (proposed type: ${proposedType}). Remove it before sending the payload to Strapi.`;
        }),
      };
    }

    const articlePayload = Object.fromEntries(
      Object.entries(payload).filter(([name]) => articleKeys.has(name)),
    );
    const articleResult = validateArticlePayload(articlePayload);
    if (!articleResult.success) {
      return {
        success: false,
        errors: articleResult.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      };
    }

    const extraShape: Record<string, z.ZodTypeAny> = {};
    for (const field of extraDescriptors) {
      if (!field) continue;
      const schema = scalarFieldSchema(field);
      if (schema) extraShape[field.name] = schema;
    }
    const extraResult = z.object(extraShape).strict().safeParse(
      Object.fromEntries(extraFields.map((name) => [name, payload[name]])),
    );
    if (!extraResult.success) {
      return {
        success: false,
        errors: extraResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      };
    }

    const data: Record<string, unknown> = { ...articleResult.data, ...extraResult.data };
    const missingRequired = collection.fields
      .filter((field) => field.required && field.type !== 'media')
      .filter((field) => {
        const value = data[field.name];
        return value === undefined || value === null || (typeof value === 'string' && !value.trim());
      })
      .map((field) => `Missing required field: ${field.name}`);
    return missingRequired.length
      ? { success: false, errors: missingRequired }
      : { success: true, data };
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of collection.fields) {
    if (!field.supported || field.type === 'media') continue;
    const schema = scalarFieldSchema(field);
    if (schema) shape[field.name] = schema;
  }

  function scalarFieldSchema(field: ImportField): z.ZodTypeAny | undefined {
    if (['string', 'text', 'richtext', 'date', 'datetime', 'uid'].includes(field.type)) {
      return z.string().nullable().optional();
    }
    if (['integer', 'float', 'decimal'].includes(field.type)) {
      return z.number().nullable().optional();
    }
    if (field.type === 'boolean') return z.boolean().nullable().optional();
    if (field.type === 'email') return z.string().email().nullable().optional();
    return undefined;
  }

  function inferTypeName(value: unknown): string {
    if (Array.isArray(value)) return `array<${inferTypeName(value[0])}>`;
    if (value === null) return 'null';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const result = z.object(shape).safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const errors = collection.fields
    .filter((field) => field.required)
    .filter((field) => field.type !== 'media')
    .filter((field) => {
      const value = (result.data as Record<string, unknown>)[field.name];
      return value === undefined || value === null || (typeof value === 'string' && !value.trim());
    })
    .map((field) => `Missing required field: ${field.name}`);

  return errors.length
    ? { success: false, errors }
    : { success: true, data: result.data as Record<string, unknown> };
}
