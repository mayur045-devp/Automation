import { z } from 'zod';
import { isValidIsoDate } from './schema';
import type { DynamicImportCollection } from './dynamicCollections';

export interface ImportField {
  name: string;
  type: string;
  required: boolean;
  supported: boolean;
  multiple?: boolean;
  allowedTypes?: string[];
  sourceField?: string;
  componentUid?: string;
  repeatable?: boolean;
  enumValues?: string[];
  componentFields?: ImportField[];
  targetField?: string;
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
      { name: 'slug', type: 'uid', required: false, supported: true, sourceField: 'slug', targetField: 'Title' },
      { name: 'description', type: 'text', required: false, supported: true, sourceField: 'description' },
      { name: 'content', type: 'richtext', required: false, supported: true, sourceField: 'content' },
      { name: 'date', type: 'date', required: false, supported: true, sourceField: 'date' },
      {
        name: 'seo',
        type: 'component',
        required: false,
        supported: true,
        componentUid: 'seo.seo',
        repeatable: false,
        sourceField: 'defaultSeo',
        componentFields: [
          { name: 'metaTitle', type: 'string', required: false, supported: true, sourceField: 'defaultSeo.metaTitle' },
          { name: 'metaDescription', type: 'string', required: false, supported: true, sourceField: 'defaultSeo.metaDescription' },
          { name: 'keywords', type: 'text', required: false, supported: true, sourceField: 'defaultSeo.keywords' },
          { name: 'metaRobots', type: 'string', required: false, supported: true, sourceField: 'defaultSeo.metaRobots' },
          { name: 'metaViewport', type: 'string', required: false, supported: true, sourceField: 'defaultSeo.metaViewPort' },
          { name: 'canonicalURL', type: 'string', required: false, supported: true, sourceField: 'defaultSeo.canonicalURL' },
          { name: 'structureData', type: 'json', required: false, supported: true, sourceField: 'defaultSeo.structureData' },
          { name: 'metaImage', type: 'media', required: false, supported: true, multiple: true, allowedTypes: ['images', 'files', 'videos', 'audios'], sourceField: 'defaultSeo.shareImage' },
          { name: 'metaSocial', type: 'media', required: false, supported: true, multiple: true, allowedTypes: ['images', 'files', 'videos', 'audios'] },
          { name: 'shareImage', type: 'media', required: false, supported: false, multiple: true, allowedTypes: ['images', 'files', 'videos', 'audios'], sourceField: 'defaultSeo.shareImage' },
        ],
      },
      { name: 'coverImage', type: 'media', required: false, supported: true, multiple: false, allowedTypes: ['images'], sourceField: 'cover', note: 'Only an image explicitly referenced in the document Cover field is uploaded.' },
      {
        name: 'Authordata',
        type: 'component',
        required: false,
        supported: true,
        componentUid: 'component.author-data',
        repeatable: false,
        sourceField: 'authordata',
        componentFields: [
          { name: 'title', type: 'string', required: false, supported: true },
          { name: 'authorName', type: 'string', required: false, supported: true, sourceField: 'authordata' },
          { name: 'Authordesignation', type: 'string', required: false, supported: true },
          { name: 'image', type: 'media', required: false, supported: true, multiple: true, allowedTypes: ['images', 'files', 'videos', 'audios'] },
        ],
      },
      {
        name: 'button',
        type: 'component',
        required: false,
        supported: true,
        componentUid: 'component.button',
        repeatable: false,
        sourceField: 'button',
        componentFields: [
          { name: 'name', type: 'string', required: false, supported: true },
          { name: 'link', type: 'string', required: false, supported: true, sourceField: 'button' },
        ],
      },
      { name: 'categoryName', type: 'string', required: false, supported: true, sourceField: 'categoryname' },
      { name: 'buttontitle', type: 'string', required: false, supported: true, sourceField: 'buttontitle' },
      { name: 'buttonsubtitle', type: 'string', required: false, supported: true, sourceField: 'buttonsubtitle' },
      { name: 'time', type: 'string', required: false, supported: true, sourceField: 'time' },
      { name: 'tital_blog_category', type: 'relation', required: false, supported: false, note: 'Relations require explicit resolution; document text is never treated as an ID.' },
      {
        name: 'contentNew',
        type: 'component',
        required: false,
        supported: true,
        componentUid: 'component.content-new',
        repeatable: true,
        sourceField: 'contentSections',
        componentFields: [
          { name: 'title', type: 'string', required: false, supported: true },
          { name: 'content', type: 'text', required: false, supported: true },
        ],
      },
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
  if (!isRecord(payload)) return { success: false, errors: ['Payload must be an object.'] };
  const shape = schemaForFields(collection.fields);
  const result = z.object(shape).strict().safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const errors: string[] = [];
  collectRequiredFieldErrors(collection.fields, result.data as Record<string, unknown>, '', errors);

  return errors.length
    ? { success: false, errors }
    : { success: true, data: result.data as Record<string, unknown> };
}

function schemaForFields(fields: readonly ImportField[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (!field.supported || field.type === 'media' || field.type === 'relation') continue;
    const schema = schemaForField(field);
    if (schema) shape[field.name] = schema.optional();
  }
  return shape;
}

function schemaForField(field: ImportField): z.ZodTypeAny | undefined {
  if (field.type === 'component') {
    if (!field.componentFields) return undefined;
    const objectSchema = z.object(schemaForFields(field.componentFields)).strict();
    return field.repeatable ? z.array(objectSchema) : objectSchema;
  }
  if (['string', 'text', 'richtext', 'uid'].includes(field.type)) {
    return z.string().nullable();
  }
  if (field.type === 'date') {
    return z.string().refine(isValidIsoDate, 'Date must be a real date in YYYY-MM-DD format').nullable();
  }
  if (field.type === 'datetime') {
    return z.string().datetime({ offset: true }).nullable();
  }
  if (field.type === 'integer') return z.number().int().nullable();
  if (['float', 'decimal'].includes(field.type)) return z.number().finite().nullable();
  if (field.type === 'boolean') return z.boolean().nullable();
  if (field.type === 'email') return z.string().email().nullable();
  if (field.type === 'enumeration') {
    if (!field.enumValues?.length) return undefined;
    return z.string().refine((value) => field.enumValues?.includes(value), {
      message: `Value must be one of: ${field.enumValues.join(', ')}`,
    }).nullable();
  }
  if (field.type === 'json') return z.unknown();
  if (field.type === 'blocks') return z.array(z.record(z.unknown())).nullable();
  return undefined;
}

function collectRequiredFieldErrors(
  fields: readonly ImportField[],
  data: Record<string, unknown>,
  prefix: string,
  errors: string[],
): void {
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const value = data[field.name];
    if (field.required && field.type !== 'media' &&
      (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) {
      errors.push(`Missing required field: ${path}`);
      continue;
    }
    if (field.type !== 'component' || !field.componentFields || value === undefined || value === null) continue;
    const instances = Array.isArray(value) ? value : [value];
    instances.forEach((instance, index) => {
      if (!isRecord(instance)) return;
      const componentPath = Array.isArray(value) ? `${path}[${index}]` : path;
      collectRequiredFieldErrors(field.componentFields!, instance, componentPath, errors);
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
