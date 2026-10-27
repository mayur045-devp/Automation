import FormData from 'form-data';
import type { ArticlePayload } from './schema';
import type { ExtractedImage } from './extract';

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
    if (!res.ok) return null;
    const json = await res.json() as any;
    const items = json?.data ?? [];
    if (items.length === 0) return null;
    return { documentId: items[0].documentId, id: items[0].id };
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

  /** Upload an image file and return its Strapi media id. */
  async uploadMedia(
    img: ExtractedImage,
    refId: number,
    field: string
  ): Promise<number> {
    const url = `${this.baseUrl}/api/upload`;
    const form = new FormData();
    form.append('files', img.buffer, {
      filename: img.filename,
      contentType: img.contentType,
    });
    form.append('refId', String(refId));
    form.append('ref', 'api::article.article');
    form.append('field', field);

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...form.getHeaders(),
      },
      body: form as any,
    });

    if (!res.ok) {
      await this.throwStrapiError(res);
    }

    const json = await res.json() as any;
    const uploaded = Array.isArray(json) ? json[0] : json;
    return uploaded?.id as number;
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

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
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
    403: 'Token lacks permission. In Strapi Admin → Settings → API Tokens, enable: Article:create, Upload:create.',
    400: 'Payload shape is invalid. Check field names match the schema.',
    404: 'Entry not found. Check the documentId.',
    413: 'File too large. Check Strapi upload size limits.',
  };
  return hints[status];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
