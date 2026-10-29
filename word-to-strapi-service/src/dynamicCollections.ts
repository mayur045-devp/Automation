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
}

export interface DynamicImportField {
  name: string;
  type: string;
  required: boolean;
  supported: boolean;
  multiple?: boolean;
  allowedTypes?: string[];
  sourceField?: string;
  componentUid?: string;
  repeatable?: boolean;
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
  'string', 'text', 'richtext', 'email', 'uid', 'date', 'datetime', 'boolean', 'integer', 'float', 'decimal',
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
  contentnew: 'contentnew',
  cover: 'cover',
  coverimage: 'cover',
  date: 'date',
  description: 'description',
  faqsection: 'faqsection',
  formsection: 'formsection',
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
): DynamicImportField {
  const type = attr.type;
  const supported = SUPPORTED_SCALAR_TYPES.has(type) || type === 'media';
  const field: DynamicImportField = {
    name,
    type,
    required: attr.required ?? false,
    supported,
    ...(type === 'media' ? {
      multiple: attr.multiple ?? false,
      allowedTypes: attr.allowedTypes ?? [],
    } : {}),
  };

  const lower = name.toLowerCase();
  if (type === 'uid') {
    field.sourceField = 'slug';
  } else if (type === 'media') {
    field.sourceField = DOCUMENT_FIELD_SOURCE_BY_NAME[lower];
    field.note = 'Media fields require an explicitly referenced embedded image or manual selection.';
  } else if (['string', 'text', 'richtext'].includes(type)) {
    // Map common Strapi field names to known source fields
    field.sourceField = DOCUMENT_FIELD_SOURCE_BY_NAME[lower];
    if (!field.sourceField && lower === 'body') field.sourceField = 'content';
  } else if (type === 'date' || type === 'datetime') {
    field.sourceField = DOCUMENT_FIELD_SOURCE_BY_NAME[lower] ?? 'date';
    field.supported = true;
  } else if (type === 'component') {
    field.componentUid = attr.component;
    field.repeatable = attr.repeatable ?? false;
    if (
      lower === 'contentnew' &&
      attr.component === 'component.content-new' &&
      attr.repeatable === true &&
      isVerifiedContentNewComponent(componentSchemas.get(attr.component))
    ) {
      field.supported = true;
      field.sourceField = 'contentSections';
      field.note = 'Mapped to verified repeatable content-new components.';
    } else {
      field.note = lower === 'contentnew'
        ? 'Component UID, repeatability, or child fields do not match the verified content-new schema.'
        : `Component field "${name}" — structured mapping may be limited.`;
    }
  } else if (type === 'relation') {
    field.note = 'Relations require explicit resolution; document text is never treated as an ID.';
  }

  return field;
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

function isVerifiedContentNewComponent(
  attributes: Record<string, StrapiAttributeInfo> | undefined,
): boolean {
  return attributes?.title?.type === 'string' &&
    attributes.content?.type === 'blocks' &&
    attributes.contentHtml?.type === 'text';
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

    const usesContentNew = userTypes.some((type) =>
      Object.entries(type.attributes).some(([name, attribute]) =>
        name.toLowerCase() === 'contentnew' &&
        attribute.type === 'component' &&
        attribute.component === 'component.content-new' &&
        attribute.repeatable === true,
      ),
    );
    const componentSchemas = new Map<string, Record<string, StrapiAttributeInfo>>();
    if (usesContentNew) {
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
          console.warn(`[dynamicCollections] Component schema verification returned ${componentResponse.status}; contentNew fields will remain unsupported.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[dynamicCollections] Component schema verification failed; contentNew fields will remain unsupported: ${message}`);
      }
    }

    return userTypes.map((type) => contentTypeToImportCollection(type, componentSchemas));
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'timeout' : err?.message ?? String(err);
    console.warn(`[dynamicCollections] Failed to fetch dynamic collections: ${msg}`);
    return null;
  }
}
