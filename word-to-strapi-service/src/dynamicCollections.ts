/**
 * dynamicCollections.ts
 *
 * Fetches live content-type metadata from the Strapi Content-Type Builder admin API.
 * Requires a Strapi Admin JWT (STRAPI_ADMIN_JWT) — distinct from the API token.
 *
 * This module does NOT modify schemas. Schema writes are handled by
 * contentTypeBuilder.ts and require explicit user confirmation.
 */

export interface StrapiContentTypeInfo {
  uid: string;
  kind: 'collectionType' | 'singleType';
  info: {
    singularName: string;
    pluralName: string;
    displayName: string;
    description?: string;
  };
  options: {
    draftAndPublish?: boolean;
  };
  attributes: Record<string, StrapiAttributeInfo>;
}

interface StrapiFormattedContentType {
  uid: string;
  schema?: {
    kind?: 'collectionType' | 'singleType';
    displayName?: string;
    singularName?: string;
    pluralName?: string;
    description?: string;
    draftAndPublish?: boolean;
    attributes?: Record<string, StrapiAttributeInfo>;
  };
  kind?: 'collectionType' | 'singleType';
  info?: StrapiContentTypeInfo['info'];
  options?: StrapiContentTypeInfo['options'];
  attributes?: Record<string, StrapiAttributeInfo>;
}

interface StrapiFormattedComponent {
  uid: string;
  schema?: { attributes?: Record<string, StrapiAttributeInfo> };
  attributes?: Record<string, StrapiAttributeInfo>;
}

export interface StrapiAttributeInfo {
  type: string;
  required?: boolean;
  component?: string;
  repeatable?: boolean;
  relation?: string;
  target?: string;
  multiple?: boolean;
  allowedTypes?: string[];
  enum?: string[];
  targetField?: string;
}

export interface DynamicImportField {
  name: string;
  type: string;
  required: boolean;
  supported: boolean;
  multiple?: boolean;
  allowedTypes?: string[];
  enumValues?: string[];
  sourceField?: string;
  componentUid?: string;
  repeatable?: boolean;
  componentFields?: DynamicImportField[];
  targetField?: string;
  note?: string;
}

export interface DynamicImportCollection {
  uid: string;
  displayName: string;
  apiName: string;
  kind: 'collectionType' | 'singleType';
  graphqlFields: string[];
  draftAndPublish: boolean;
  duplicateField?: string;
  mapper: 'article' | 'scalar';
  fields: DynamicImportField[];
  /** True when fetched from live Strapi, false when from static fallback */
  dynamic: boolean;
}

const SUPPORTED_SCALAR_TYPES = new Set([
  'string', 'text', 'richtext', 'email', 'uid', 'date', 'datetime', 'boolean', 'integer', 'float', 'decimal', 'blocks',
]);

const DOCUMENT_FIELD_SOURCE_BY_NAME: Record<string, string> = {
  author: 'authordata',
  authordata: 'authordata',
  authorname: 'authordata',
  blogcategories: 'blogcategories',
  button: 'button',
  buttonsubtitle: 'buttonsubtitle',
  buttontitle: 'buttontitle',
  category: 'categoryname',
  categoryname: 'categoryname',
  content: 'content',
  contentnew: 'contentSections',
  cover: 'cover',
  coverimage: 'cover',
  date: 'date',
  description: 'description',
  faqsection: 'faqsection',
  formsection: 'formsection',
  seo: 'defaultSeo',
  defaultseo: 'defaultSeo',
  popularityname: 'popularityname',
  shareimage: 'defaultSeo.shareImage',
  slug: 'slug',
  summary: 'description',
  time: 'time',
  title: 'title',
};

/**
 * Map a Strapi attribute to an importable field descriptor.
 */
function attributeToField(
  name: string,
  attr: StrapiAttributeInfo,
  componentSchemas: ReadonlyMap<string, Record<string, StrapiAttributeInfo>>,
  parentSourceField?: string,
  componentStack: readonly string[] = [],
): DynamicImportField {
  const type = attr.type;
  const supported = SUPPORTED_SCALAR_TYPES.has(type) || type === 'media' || name === 'contentNew';
  const field: DynamicImportField = {
    name,
    type,
    required: attr.required ?? false,
    supported,
    ...(type === 'media' ? {
      multiple: attr.multiple ?? false,
      allowedTypes: attr.allowedTypes ?? [],
    } : {}),
    ...(type === 'enumeration' && attr.enum ? { enumValues: [...attr.enum] } : {}),
    ...(attr.targetField ? { targetField: attr.targetField } : {}),
  };

  const lower = name.toLowerCase();
  if (type === 'component') {
    field.componentUid = attr.component;
    field.repeatable = attr.repeatable ?? false;
    field.sourceField = DOCUMENT_FIELD_SOURCE_BY_NAME[lower] ?? name;
    const componentAttributes = attr.component && !componentStack.includes(attr.component)
      ? componentSchemas.get(attr.component)
      : undefined;
    if (componentAttributes) {
      field.componentFields = Object.entries(componentAttributes).map(([childName, childAttribute]) =>
        attributeToField(
          childName,
          childAttribute,
          componentSchemas,
          sourceFieldForComponent(name, childName, parentSourceField),
          attr.component ? [...componentStack, attr.component] : componentStack,
        ),
      );
      field.supported = true;
      if (lower === 'contentnew') {
        const title = field.componentFields.find((child) =>
          child.name.toLowerCase() === 'title' && child.type === 'string');
        const content = field.componentFields.find((child) =>
          child.name.toLowerCase() === 'content' &&
          ['text', 'richtext', 'blocks'].includes(child.type));
        field.supported = attr.repeatable === true && Boolean(title && content);
        if (!field.supported) {
          field.note = 'Section mapping requires a repeatable component with title and content fields.';
        }
      }
    } else {
      field.supported = false;
      field.note = `Component field "${name}" has no verified component schema.`;
    }
  } else if (type === 'relation') {
    field.note = 'Relations require explicit resolution; document text is never treated as an ID.';
  } else if (type === 'media') {
    field.sourceField = sourceFieldFor(name, parentSourceField);
    field.note = 'Media fields require an explicit image assignment.';
  } else {
    field.sourceField = sourceFieldFor(name, parentSourceField);
  }

  return field;
}

function sourceFieldFor(name: string, parentSourceField?: string): string {
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (parentSourceField === 'defaultSeo') return `defaultSeo.${name}`;
  if (parentSourceField === 'authordata' && lower === 'authorname') return 'authordata';
  if (parentSourceField === 'button' && lower === 'link') return 'button';
  return DOCUMENT_FIELD_SOURCE_BY_NAME[lower] ?? (lower === 'body' ? 'content' : name);
}

function sourceFieldForComponent(
  componentName: string,
  childName: string,
  parentSourceField?: string,
): string {
  const componentSource = DOCUMENT_FIELD_SOURCE_BY_NAME[
    componentName.toLowerCase().replace(/[^a-z0-9]/g, '')
  ] ?? parentSourceField;
  return sourceFieldFor(childName, componentSource);
}

/**
 * Convert a Strapi content type definition to a DynamicImportCollection.
 */
export function contentTypeToImportCollection(
  ct: StrapiContentTypeInfo,
  componentSchemas: ReadonlyMap<string, Record<string, StrapiAttributeInfo>> = new Map(),
): DynamicImportCollection {
  const fields: DynamicImportField[] = Object.entries(ct.attributes).map(([name, attr]) =>
    attributeToField(name, attr, componentSchemas)
  );

  // Detect the best duplicate-check field (title > name > first supported string field)
  const titleField = fields.find((f) => f.name.toLowerCase() === 'title' && f.supported);
  const nameField = fields.find((f) => f.name.toLowerCase() === 'name' && f.supported);
  const firstString = fields.find((f) => f.supported && ['string', 'text'].includes(f.type));
  // Determine GraphQL field names (pluralName for collections, singularName for singleTypes)
  const graphqlFields = ct.kind === 'collectionType'
    ? [ct.info.pluralName, ct.info.singularName].filter(Boolean)
    : [ct.info.singularName].filter(Boolean);

  // Use article mapper only for the known article UID
  const mapper: 'article' | 'scalar' = ct.uid === 'api::article.article' ? 'article' : 'scalar';
  const duplicateField = ct.kind === 'singleType'
    ? undefined
    : titleField?.name ?? nameField?.name ?? firstString?.name;

  return {
    uid: ct.uid,
    displayName: ct.info.displayName,
    apiName: ct.kind === 'collectionType' ? ct.info.pluralName : ct.info.singularName,
    kind: ct.kind,
    graphqlFields,
    draftAndPublish: ct.options.draftAndPublish ?? false,
    ...(duplicateField ? { duplicateField } : {}),
    mapper,
    fields,
    dynamic: true,
  };
}

function normalizeContentType(record: StrapiFormattedContentType): StrapiContentTypeInfo | null {
  const schema = record.schema;
  const kind = schema?.kind ?? record.kind;
  const displayName = schema?.displayName ?? record.info?.displayName;
  const singularName = schema?.singularName ?? record.info?.singularName;
  const pluralName = schema?.pluralName ?? record.info?.pluralName;
  const attributes = schema?.attributes ?? record.attributes;

  if (
    !record.uid ||
    (kind !== 'collectionType' && kind !== 'singleType') ||
    !displayName ||
    !singularName ||
    !pluralName ||
    !attributes ||
    typeof attributes !== 'object'
  ) {
    return null;
  }

  return {
    uid: record.uid,
    kind,
    info: {
      displayName,
      singularName,
      pluralName,
      ...(schema?.description ? { description: schema.description } : {}),
    },
    options: { draftAndPublish: schema?.draftAndPublish ?? record.options?.draftAndPublish ?? false },
    attributes,
  };
}

/**
 * Fetch all user-defined content types from the Strapi Content-Type Builder admin API.
 * Returns null if the admin JWT is not configured or if the API is unreachable.
 */
export async function fetchDynamicCollections(
  strapiUrl: string,
  adminJwt: string,
): Promise<DynamicImportCollection[] | null> {
  if (!adminJwt) return null;

  const base = strapiUrl.replace(/\/$/, '');
  const TIMEOUT_MS = 10_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    const fetchFn = (globalThis.fetch ?? (await import('node-fetch')).default) as typeof fetch;
    try {
      res = await fetchFn(`${base}/api/content-type-builder/content-types`, {
        headers: {
          Authorization: `Bearer ${adminJwt}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.warn(`[dynamicCollections] Content-Type Builder API returned ${res.status}. Admin JWT may be wrong or expired.`);
      return null;
    }

    const json = await res.json() as { data?: StrapiFormattedContentType[] };
    const allTypes = (json?.data ?? [])
      .map(normalizeContentType)
      .filter((type): type is StrapiContentTypeInfo => type !== null);

    // Filter: only user-defined types (skip plugin types and internal strapi types)
    const userTypes = allTypes.filter((ct) =>
      ct.uid.startsWith('api::') &&
      (ct.kind === 'collectionType' || ct.kind === 'singleType')
    );

    const componentSchemas = new Map<string, Record<string, StrapiAttributeInfo>>();
    try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          let componentResponse: Response;
        try {
          componentResponse = await fetchFn(
            `${base}/api/content-type-builder/components`,
            {
              headers: {
                Authorization: `Bearer ${adminJwt}`,
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
            },
          );
        } finally {
          clearTimeout(timer);
        }
        if (componentResponse.ok) {
          const componentData = await componentResponse.json() as { data?: StrapiFormattedComponent[] };
          for (const component of componentData.data ?? []) {
            const attributes = component.schema?.attributes ?? component.attributes;
            if (component.uid && attributes) componentSchemas.set(component.uid, attributes);
          }
        } else {
          console.warn(`[dynamicCollections] Component schema discovery returned ${componentResponse.status}; component fields will remain unsupported.`);
        }
  } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[dynamicCollections] Component schema discovery failed; component fields will remain unsupported: ${message}`);
    }

    return userTypes.map((type) => contentTypeToImportCollection(type, componentSchemas));
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'timeout' : err?.message ?? String(err);
    console.warn(`[dynamicCollections] Failed to fetch dynamic collections: ${msg}`);
    return null;
  }
}
