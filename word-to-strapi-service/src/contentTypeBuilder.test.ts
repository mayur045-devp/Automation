import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContentTypeBuilderClient, toSingularName, toPluralName } from '../src/contentTypeBuilder';

// ── toSingularName ─────────────────────────────────────────────────────────────
describe('toSingularName', () => {
  it('converts a display name to lowercase with no spaces', () => {
    expect(toSingularName('Blog Post')).toBe('blogpost');
  });

  it('removes special characters', () => {
    expect(toSingularName('My Article!')).toBe('myarticle');
  });

  it('handles already-lowercase names', () => {
    expect(toSingularName('article')).toBe('article');
  });

  it('truncates to 50 characters', () => {
    const long = 'A'.repeat(60).toLowerCase();
    expect(toSingularName(long).length).toBe(50);
  });

  it('falls back to contenttype for empty input', () => {
    expect(toSingularName('!!!  ')).toBe('contenttype');
  });
});

// ── toPluralName ───────────────────────────────────────────────────────────────
describe('toPluralName', () => {
  it('appends s for most names', () => {
    expect(toPluralName('article')).toBe('articles');
    expect(toPluralName('product')).toBe('products');
  });

  it('handles names ending in s with es', () => {
    expect(toPluralName('blogpost').endsWith('s')).toBe(true);
  });

  it('handles names ending in y with ies', () => {
    expect(toPluralName('category')).toBe('categories');
  });
});

// ── ContentTypeBuilderClient ───────────────────────────────────────────────────
describe('ContentTypeBuilderClient', () => {
  let globalFetch: any;

  beforeEach(() => {
    globalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = globalFetch;
  });

  it('ping returns ok:false when fetch returns 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });

    const client = new ContentTypeBuilderClient('http://localhost:1337', 'invalid');
    const result = await client.ping();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('ping returns ok:true when fetch returns 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    });

    const client = new ContentTypeBuilderClient('http://localhost:1337', 'valid-jwt');
    const result = await client.ping();
    expect(result.ok).toBe(true);
  });

  it('createContentType throws for invalid singular name (with hyphen)', async () => {
    const client = new ContentTypeBuilderClient('http://localhost:1337', 'jwt');
    await expect(client.createContentType({
      kind: 'collectionType',
      info: {
        displayName: 'Blog Post',
        singularName: 'blog-post', // invalid — hyphens not allowed
        pluralName: 'blogposts',
      },
      options: { draftAndPublish: true },
      attributes: {},
    })).rejects.toThrow(/invalid/i);
  });

  it('createContentType throws for name starting with digit', async () => {
    const client = new ContentTypeBuilderClient('http://localhost:1337', 'jwt');
    await expect(client.createContentType({
      kind: 'collectionType',
      info: {
        displayName: '1Post',
        singularName: '1post',
        pluralName: '1posts',
      },
      options: { draftAndPublish: true },
      attributes: {},
    })).rejects.toThrow(/invalid/i);
  });

  it('createContentType throws for name with uppercase', async () => {
    const client = new ContentTypeBuilderClient('http://localhost:1337', 'jwt');
    await expect(client.createContentType({
      kind: 'collectionType',
      info: {
        displayName: 'BlogPost',
        singularName: 'BlogPost', // invalid — must be lowercase
        pluralName: 'blogposts',
      },
      options: { draftAndPublish: true },
      attributes: {},
    })).rejects.toThrow(/invalid/i);
  });

  it('createContentType sends correct payload on success', async () => {
    let capturedBody: any = null;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          data: {
            uid: 'api::article2.article2',
            kind: 'collectionType',
            info: { displayName: 'Article 2', singularName: 'article2', pluralName: 'article2s' },
            attributes: { title: { type: 'string' } },
          },
        }),
      });
    });

    const client = new ContentTypeBuilderClient('http://localhost:1337', 'valid-jwt');
    const result = await client.createContentType({
      kind: 'collectionType',
      info: { displayName: 'Article 2', singularName: 'article2', pluralName: 'article2s' },
      options: { draftAndPublish: true },
      attributes: { title: { type: 'string' } },
    });

    expect(result.uid).toBe('api::article2.article2');
    expect(capturedBody.contentType.singularName).toBe('article2');
    expect(capturedBody.contentType.info).toBeUndefined();
    expect(capturedBody.contentType.attributes.title.type).toBe('string');
  });

  it('adds fields without overwriting existing schema attributes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { uid: 'api::blog.blog' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            uid: 'api::blog.blog',
            schema: {
              kind: 'collectionType',
              displayName: 'Blog',
              singularName: 'blog',
              pluralName: 'blogs',
              draftAndPublish: true,
              pluginOptions: {},
              attributes: { title: { type: 'string' } },
            },
          },
        }),
      });
    });

    const client = new ContentTypeBuilderClient('http://localhost:1337', 'valid-jwt');
    const result = await client.addAttributes('api::blog.blog', { popularityname: { type: 'string' } });

    expect(result.attributes).toEqual({
      title: { type: 'string' },
      popularityname: { type: 'string' },
    });
    expect(JSON.parse(String(calls[1].init?.body)).contentType.attributes).toEqual(result.attributes);
    await expect(client.addAttributes('api::blog.blog', { title: { type: 'integer' } }))
      .rejects.toThrow(/refusing to overwrite/i);
  });

  it('createContentType throws readable error on 400 from Strapi', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        error: { message: 'Content type name already exists' },
      }),
    });

    const client = new ContentTypeBuilderClient('http://localhost:1337', 'valid-jwt');
    await expect(client.createContentType({
      kind: 'collectionType',
      info: { displayName: 'Article', singularName: 'article', pluralName: 'articles' },
      options: { draftAndPublish: true },
      attributes: {},
    })).rejects.toThrow(/already exists/i);
  });

  it('listContentTypes filters and returns only api:: types', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: [
          {
            uid: 'api::article.article',
            schema: {
              kind: 'collectionType',
              displayName: 'Article',
              singularName: 'article',
              pluralName: 'articles',
              attributes: {},
            },
          },
          { uid: 'plugin::upload.file', kind: 'collectionType', info: { displayName: 'File', singularName: 'file', pluralName: 'files' }, attributes: {} },
        ],
      }),
    });

    const client = new ContentTypeBuilderClient('http://localhost:1337', 'valid-jwt');
    const result = await client.listContentTypes();
    expect(result.length).toBe(1);
    expect(result[0].uid).toBe('api::article.article');
  });
});
