/**
 * contentTypeBuilder.ts
 *
 * Strapi 5 Content-Type Builder admin API client.
 * Used for schema introspection and explicitly approved schema changes — never for content.
 *
 * Requires STRAPI_ADMIN_JWT (admin user JWT token, NOT the API token).
 * Schema creation requires explicit user confirmation — never auto-create.
 *
 * Strapi 5 Content-Type Builder REST API:
 *   GET  /api/content-type-builder/content-types       — list all types
 *   POST /api/content-type-builder/content-types       — create new type
 *   GET  /api/content-type-builder/components          — list all components
 */

export interface ContentTypeAttribute {
  type: string;
  required?: boolean;
  unique?: boolean;
  maxLength?: number;
  minLength?: number;
  default?: string | number | boolean;
  regex?: string;
  // For uid
  targetField?: string;
  // For relation
  relation?: string;
  target?: string;
  // For component
  component?: string;
  repeatable?: boolean;
  // For media
  multiple?: boolean;
  allowedTypes?: string[];
  // For enum
  enum?: string[];
  // For integer/decimal
  min?: number;
  max?: number;
}

export interface ContentTypeInfo {
  displayName: string;
  singularName: string;
  pluralName: string;
  description?: string;
}

export interface ContentTypeOptions {
  draftAndPublish?: boolean;
}

export interface ContentTypeCreatePayload {
  kind: 'collectionType' | 'singleType';
  info: ContentTypeInfo;
  options: ContentTypeOptions;
  attributes: Record<string, ContentTypeAttribute>;
}

export interface ContentTypeBuilderResult {
  uid: string;
  kind: 'collectionType' | 'singleType';
  info: ContentTypeInfo;
  options: ContentTypeOptions;
  pluginOptions?: Record<string, unknown>;
  attributes: Record<string, ContentTypeAttribute>;
}

const TIMEOUT_MS = 30_000; // Schema creation can be slow (triggers Strapi rebuild)

export class ContentTypeBuilderClient {
  private baseUrl: string;
  private adminJwt: string;

  constructor(strapiUrl: string, adminJwt: string) {
    this.baseUrl = strapiUrl.replace(/\/$/, '');
    this.adminJwt = adminJwt;
  }

  private get authHeaders() {
    return {
      Authorization: `Bearer ${this.adminJwt}`,
      'Content-Type': 'application/json',
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const fetchFn = (globalThis.fetch ?? (await import('node-fetch')).default) as typeof fetch;
      return await fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * List all user-defined content types.
   */
  async listContentTypes(): Promise<ContentTypeBuilderResult[]> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/api/content-type-builder/content-types`,
      { headers: this.authHeaders }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      throw new Error(`Content-Type Builder list failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    }
    const json = await res.json() as { data?: unknown[] };
    return (json?.data ?? [])
      .map(normalizeContentTypeBuilderResult)
      .filter((contentType): contentType is ContentTypeBuilderResult =>
        contentType !== null && contentType.uid.startsWith('api::'));
  }

  async getContentType(uid: string): Promise<ContentTypeBuilderResult> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/api/content-type-builder/content-types/${encodeURIComponent(uid)}`,
      { headers: this.authHeaders }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      throw new Error(`Content-Type Builder read failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    }

    const json = await res.json() as { data?: unknown };
    const contentType = normalizeContentTypeBuilderResult(json.data);
    if (!contentType) throw new Error(`Content-Type Builder returned no usable schema for "${uid}".`);
    return contentType;
  }

  /**
   * Create a new collection type or single type.
   * This triggers Strapi to restart and regenerate schema files.
   * Only call after explicit user confirmation.
   */
  async createContentType(payload: ContentTypeCreatePayload): Promise<ContentTypeBuilderResult> {
    // Validate naming conventions for Strapi 5
    validateContentTypeName(payload.info.singularName, 'singularName');
    validateContentTypeName(payload.info.pluralName, 'pluralName');

    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/api/content-type-builder/content-types`,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: JSON.stringify({ contentType: toContentTypeApiPayload(payload) }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      const msg = body?.error?.message ?? body?.message ?? res.statusText;
      throw new Error(`Content-Type Builder create failed (${res.status}): ${msg}`);
    }

    const json = await res.json() as { data?: { uid?: string } };
    const uid = json?.data?.uid;
    if (!uid) {
      throw new Error('Content-Type Builder returned no uid after create');
    }
    return { uid, ...payload };
  }

  /**
   * Add new attributes without removing or changing any existing definitions.
   * Strapi's authenticated Content-Type Builder update route is development-only.
   */
  async addAttributes(
    uid: string,
    additions: Record<string, ContentTypeAttribute>,
  ): Promise<ContentTypeBuilderResult> {
    const existing = await this.getContentType(uid);
    const collisions = Object.keys(additions).filter((name) =>
      Object.prototype.hasOwnProperty.call(existing.attributes, name));
    if (collisions.length > 0) {
      throw new Error(`Refusing to overwrite existing fields: ${collisions.join(', ')}`);
    }
    if (Object.keys(additions).length === 0) {
      throw new Error('At least one new field is required.');
    }

    const contentType = {
      ...existing.info,
      kind: existing.kind,
      draftAndPublish: existing.options.draftAndPublish ?? false,
      pluginOptions: existing.pluginOptions ?? {},
      attributes: { ...existing.attributes, ...additions },
    };
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/api/content-type-builder/content-types/${encodeURIComponent(uid)}`,
      {
        method: 'PUT',
        headers: this.authHeaders,
        body: JSON.stringify({ contentType }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      const msg = body?.error?.message ?? body?.message ?? res.statusText;
      throw new Error(`Content-Type Builder update failed (${res.status}): ${msg}`);
    }

    const json = await res.json() as { data?: { uid?: string } };
    if (json?.data?.uid !== uid) {
      throw new Error(`Content-Type Builder updated an unexpected content type for "${uid}".`);
    }
    return {
      ...existing,
      attributes: { ...existing.attributes, ...additions },
    };
  }

  /**
   * Check if the admin JWT is valid by pinging the content-type-builder.
   */
  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}/api/content-type-builder/content-types`,
        { headers: this.authHeaders }
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Admin JWT is invalid or expired (HTTP ${res.status})` };
      }
      return { ok: res.ok };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }
}

function toContentTypeApiPayload(payload: ContentTypeCreatePayload): Record<string, unknown> {
  return {
    ...payload.info,
    kind: payload.kind,
    draftAndPublish: payload.options.draftAndPublish ?? false,
    attributes: payload.attributes,
  };
}

function normalizeContentTypeBuilderResult(value: unknown): ContentTypeBuilderResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, any>;
  const schema = record.schema ?? record;
  const kind = schema.kind ?? record.kind;
  const displayName = schema.displayName ?? schema.info?.displayName;
  const singularName = schema.singularName ?? schema.info?.singularName;
  const pluralName = schema.pluralName ?? schema.info?.pluralName;
  const attributes = schema.attributes ?? record.attributes;
  if (
    typeof record.uid !== 'string' ||
    (kind !== 'collectionType' && kind !== 'singleType') ||
    typeof displayName !== 'string' ||
    typeof singularName !== 'string' ||
    typeof pluralName !== 'string' ||
    !attributes ||
    typeof attributes !== 'object'
  ) return null;

  return {
    uid: record.uid,
    kind,
    info: {
      displayName,
      singularName,
      pluralName,
      ...(schema.description ? { description: schema.description } : {}),
    },
    options: { draftAndPublish: schema.draftAndPublish ?? schema.options?.draftAndPublish ?? false },
    pluginOptions: schema.pluginOptions ?? {},
    attributes,
  };
}

/**
 * Validate a Strapi content type name follows required conventions:
 * lowercase, letters only (no spaces, hyphens, underscores, or numbers as start).
 */
function validateContentTypeName(name: string, field: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (!/^[a-z][a-z0-9]*$/.test(name)) {
    throw new Error(
      `${field} "${name}" is invalid. Use only lowercase letters and digits (e.g. "article", "blogpost"). ` +
      'Strapi 5 does not accept hyphens, underscores, spaces, or uppercase in type names.'
    );
  }
  if (name.length > 50) {
    throw new Error(`${field} "${name}" is too long. Max 50 characters.`);
  }
}

/**
 * Generate a valid Strapi singular name from a display name.
 * e.g. "Blog Post" -> "blogpost"
 */
export function toSingularName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '')
    .substring(0, 50)
    || 'contenttype';
}

/**
 * Generate a valid Strapi plural name from a display name.
 * e.g. "Blog Post" -> "blogposts"
 */
export function toPluralName(singularName: string): string {
  // Simple English pluralization
  if (singularName.endsWith('s')) return `${singularName}es`;
  if (singularName.endsWith('y')) return `${singularName.slice(0, -1)}ies`;
  return `${singularName}s`;
}
