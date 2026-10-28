import type { ArticlePayload } from './schema';
import type { ExtractedImage } from './extract';
import type { ImportCollection } from './collections';

export interface StrapiCreateResult {
  documentId: string;
  id: number;
  slug: string | null;
  adminLink: string;
}

export interface StrapiError {
  status: number;
  message: string;
  hint?: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const TIMEOUT_MS = 15_000;

/**
 * Strapi 5 REST API client — server-side only.
 * Tokens are never logged or returned to the frontend.
 */
export class StrapiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /** Find an article by Title equality (slug duplicate check). */
  async findByTitle(title: string): Promise<{ documentId: string; id: number } | null> {
    const url = `${this.baseUrl}/api/articles?filters[Title][$eq]=${encodeURIComponent(title)}&status=draft&fields=documentId,id`;
    const res = await this.fetchWithTimeout(url, { headers: this.headers });
    if (!res.ok) await this.throwStrapiError(res);
    const json = await res.json() as any;
    const items = json?.data ?? [];
    if (items.length === 0) return null;
    return { documentId: items[0].documentId, id: items[0].id };
  }

  async findByField(
    collection: ImportCollection,
    field: string,
    value: string,
  ): Promise<{ documentId: string; id: number } | null> {
    if (!collection.fields.some((candidate) => candidate.name === field && candidate.supported)) {
      throw new Error(`Duplicate field "${field}" is not part of the verified ${collection.uid} schema.`);
    }

    const params = new URLSearchParams({
      [`filters[${field}][$eq]`]: value,
      status: 'draft',
      'fields[0]': 'documentId',
      'fields[1]': 'id',
    });
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/api/${collection.apiName}?${params.toString()}`,
      { headers: this.headers },
    );
    if (!res.ok) await this.throwStrapiError(res);
    const json = await res.json() as any;
    const item = json?.data?.[0];
    if (!item) return null;
    return { documentId: item.documentId, id: item.id };
  }

  /** Create a DRAFT article entry. Never publishes. */
  async createDraft(payload: ArticlePayload): Promise<StrapiCreateResult> {
    const url = `${this.baseUrl}/api/articles?status=draft`;
    const body = JSON.stringify({ data: payload });

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.headers,
      body,
    });

    if (!res.ok) {
      await this.throwStrapiError(res);
    }

    const json = await res.json() as any;
    const entry = json?.data;
    if (!entry?.documentId) {
      throw new Error('Strapi returned no documentId after create');
    }

    return {
      documentId: entry.documentId,
      id: entry.id,
      slug: entry.slug ?? null,
      adminLink: `${this.baseUrl}/admin/content-manager/collection-types/api::article.article/${entry.documentId}`,
    };
  }

  async createDraftForCollection(
    collection: ImportCollection,
    payload: Record<string, unknown>,
  ): Promise<StrapiCreateResult> {
    const status = collection.draftAndPublish ? '?status=draft' : '';
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/${collection.apiName}${status}`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ data: payload }),
      },
    );

    if (!res.ok) await this.throwStrapiError(res);

    const json = await res.json() as any;
    const entry = json?.data;
    if (!entry?.documentId) {
      throw new Error('Strapi returned no documentId after create');
    }

    return {
      documentId: entry.documentId,
      id: entry.id,
      slug: entry.slug ?? null,
      adminLink: `${this.baseUrl}/admin/content-manager/${collection.kind === 'singleType' ? 'single-types' : 'collection-types'}/${collection.uid}/${entry.documentId}`,
    };
  }

  /**
   * Upload an image file and return its Strapi media id.
   * @param img - The image to upload
   * @param refId - The numeric ID of the entry to attach to
   * @param field - The field name to attach to (e.g. 'coverImage')
   * @param ref - The content type UID (e.g. 'api::article.article')
   */
  async uploadMedia(
    img: ExtractedImage,
    refId: number,
    field: string,
    ref: string = 'api::article.article',
  ): Promise<number> {
    const url = `${this.baseUrl}/api/upload`;
    const form = new globalThis.FormData();
    form.append('files', new Blob([new Uint8Array(img.buffer)], { type: img.contentType }), img.filename);
    const fileInfo: { name: string; alternativeText?: string; caption?: string } = {
      name: img.filename,
    };
    if (img.altText && !/^Image \d+$/i.test(img.altText)) {
      fileInfo.alternativeText = img.altText;
    }
    if (img.caption || (img.location && img.location !== 'Document')) {
      fileInfo.caption = img.caption || img.location;
    }
    form.append('fileInfo', JSON.stringify(fileInfo));
    form.append('refId', String(refId));
    form.append('ref', ref);
    form.append('field', field);

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: form,
    });

    if (!res.ok) {
      await this.throwStrapiError(res);
    }

    const json = await res.json() as any;
    const uploaded = Array.isArray(json) ? json[0] : json;
    if (!Number.isSafeInteger(uploaded?.id) || uploaded.id <= 0) {
      throw new Error('Strapi upload response did not contain a valid media id.');
    }
    return uploaded.id;
  }

  /** Fetch an article by documentId to verify saved data. */
  async getByDocumentId(documentId: string): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({
      status: 'draft',
      'populate[coverImage]': 'true',
      'populate[seo]': 'true',
      'populate[Authordata]': 'true',
      'populate[button]': 'true',
    });
    const url = `${this.baseUrl}/api/articles/${encodeURIComponent(documentId)}?${query.toString()}`;
    const res = await this.fetchWithTimeout(url, { headers: this.headers });
    if (!res.ok) await this.throwStrapiError(res);
    const json = await res.json() as any;
    return json?.data ?? {};
  }

  async getByDocumentIdForCollection(
    collection: ImportCollection,
    documentId: string,
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    if (collection.draftAndPublish) query.set('status', 'draft');
    for (const field of collection.fields) {
      if (field.type === 'media' || field.type === 'component' || field.type === 'dynamiczone') {
        query.set(`populate[${field.name}]`, 'true');
      }
    }
    const suffix = query.toString();
    const url = collection.kind === 'singleType'
      ? `${this.baseUrl}/api/${collection.apiName}${suffix ? `?${suffix}` : ''}`
      : `${this.baseUrl}/api/${collection.apiName}/${encodeURIComponent(documentId)}${suffix ? `?${suffix}` : ''}`;
    const res = await this.fetchWithTimeout(url, { headers: this.headers });
    if (!res.ok) await this.throwStrapiError(res);
    const json = await res.json() as any;
    return json?.data ?? {};
  }

  private async fetchWithRetry(url: string, init: RequestInit, attempt = 1): Promise<Response> {
    try {
      return await this.fetchWithTimeout(url, init);
    } catch (err: any) {
      if (attempt >= MAX_RETRIES) throw err;
      console.warn(`[strapi-client] Retry ${attempt}/${MAX_RETRIES} after error: ${err?.message}`);
      await sleep(RETRY_DELAY_MS * attempt);
      return this.fetchWithRetry(url, init, attempt + 1);
    }
  }

  async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const fetchFn = (globalThis.fetch ?? (await import('node-fetch')).default) as any;
      return await fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwStrapiError(res: Response): Promise<never> {
    let body: any = {};
    try { body = await res.json(); } catch { /* ignore */ }

    const msg = body?.error?.message ?? body?.message ?? res.statusText;
    const hint = getHint(res.status);

    const err: StrapiError = { status: res.status, message: msg, hint };
    console.error(`[strapi-client] ${res.status} ${msg}${hint ? ` — ${hint}` : ''}`);
    throw Object.assign(new Error(`Strapi ${res.status}: ${msg}`), { strapiError: err });
  }
}

function getHint(status: number): string | undefined {
  const hints: Record<number, string> = {
    401: 'Token is invalid or expired. Check STRAPI_API_TOKEN.',
    403: 'Token lacks permission. In Strapi Admin → Settings → API Tokens, enable find/create for the selected content type; Article media uploads also require Upload:create.',
    400: 'Payload shape is invalid. Check field names match the schema.',
    404: 'Entry not found. Check the documentId.',
    413: 'File too large. Check Strapi upload size limits.',
  };
  return hints[status];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
