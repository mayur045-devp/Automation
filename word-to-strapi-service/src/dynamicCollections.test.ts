import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDynamicCollections,
  contentTypeToImportCollection,
  type StrapiContentTypeInfo,
} from '../src/dynamicCollections';

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeContentType(overrides: Partial<StrapiContentTypeInfo> = {}): StrapiContentTypeInfo {
  return {
    uid: 'api::blog.blog',
    kind: 'collectionType',
    info: {
      singularName: 'blog',
      pluralName: 'blogs',
      displayName: 'Blog',
    },
    options: { draftAndPublish: true },
    attributes: {
      title: { type: 'string' },
      content: { type: 'richtext' },
      slug: { type: 'uid' },
      date: { type: 'date' },
      cover: { type: 'media', multiple: false, allowedTypes: ['images'] },
    },
    ...overrides,
  };
}

// ── Unit tests: contentTypeToImportCollection ──────────────────────────────────
describe('contentTypeToImportCollection', () => {
  it('converts a collectionType correctly', () => {
    const ct = makeContentType();
    const result = contentTypeToImportCollection(ct);

    expect(result.uid).toBe('api::blog.blog');
    expect(result.displayName).toBe('Blog');
    expect(result.apiName).toBe('blogs');
    expect(result.kind).toBe('collectionType');
    expect(result.draftAndPublish).toBe(true);
    expect(result.dynamic).toBe(true);
    expect(result.graphqlFields).toContain('blogs');
  });

  it('converts a singleType correctly', () => {
    const ct = makeContentType({
      uid: 'api::homepage.homepage',
      kind: 'singleType',
      info: { singularName: 'homepage', pluralName: 'homepages', displayName: 'Homepage' },
    });
    const result = contentTypeToImportCollection(ct);

    expect(result.kind).toBe('singleType');
    expect(result.apiName).toBe('homepage'); // singularName for singleType
    expect(result.graphqlFields).toContain('homepage');
    expect(result.graphqlFields).not.toContain('homepages');
  });

  it('maps known scalar types as supported fields', () => {
    const ct = makeContentType();
    const result = contentTypeToImportCollection(ct);

    const titleField = result.fields.find((f) => f.name === 'title');
    expect(titleField?.supported).toBe(true);
    expect(titleField?.type).toBe('string');
    expect(titleField?.sourceField).toBe('title');

    const contentField = result.fields.find((f) => f.name === 'content');
    expect(contentField?.supported).toBe(true);
    expect(contentField?.sourceField).toBe('content');

    const slugField = result.fields.find((f) => f.name === 'slug');
    expect(slugField?.type).toBe('uid');
  });

  it('marks media fields as supported with a note', () => {
    const ct = makeContentType();
    const result = contentTypeToImportCollection(ct);

    const coverField = result.fields.find((f) => f.name === 'cover');
    expect(coverField?.type).toBe('media');
    expect(coverField?.note).toBeTruthy();
  });

  it('detects best duplicate-check field (title > name > first string)', () => {
    // Title field present
    const withTitle = contentTypeToImportCollection(makeContentType());
    expect(withTitle.duplicateField).toBe('title');

    // No title, has name
    const withName = contentTypeToImportCollection(makeContentType({
      attributes: { name: { type: 'string' }, bio: { type: 'text' } },
    }));
    expect(withName.duplicateField).toBe('name');

    // No title or name
    const withOther = contentTypeToImportCollection(makeContentType({
      attributes: { headline: { type: 'string' } },
    }));
    expect(withOther.duplicateField).toBe('headline');
  });

  it('uses article mapper for the known article UID', () => {
    const ct = makeContentType({ uid: 'api::article.article' });
    const result = contentTypeToImportCollection(ct);
    expect(result.mapper).toBe('article');
  });

  it('uses scalar mapper for all other content types', () => {
    const ct = makeContentType();
    const result = contentTypeToImportCollection(ct);
    expect(result.mapper).toBe('scalar');
  });

  it('maps relation attributes as unsupported fields', () => {
    const ct = makeContentType({
      attributes: {
        category: { type: 'relation', relation: 'manyToOne', target: 'api::category.category' },
      },
    });
    const result = contentTypeToImportCollection(ct);
    const catField = result.fields.find((f) => f.name === 'category');
    expect(catField?.supported).toBe(false);
    expect(catField?.note).toMatch(/relation/i);
  });
});

// ── Integration test: fetchDynamicCollections ──────────────────────────────────
describe('fetchDynamicCollections', () => {
  let globalFetch: any;

  beforeEach(() => {
    globalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = globalFetch;
  });

  it('returns null when adminJwt is empty', async () => {
    const result = await fetchDynamicCollections('http://localhost:1337', '');
    expect(result).toBeNull();
  });

  it('returns null when admin API returns 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
    });

    const result = await fetchDynamicCollections('http://localhost:1337', 'invalid-jwt');
    expect(result).toBeNull();
  });

  it('filters plugin types and returns only user api:: types', async () => {
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
              draftAndPublish: true,
              attributes: { title: { type: 'string' } },
            },
          },
          {
            uid: 'api::soham.soham',
            schema: {
              kind: 'collectionType',
              displayName: 'Soham',
              singularName: 'soham',
              pluralName: 'sohams',
              attributes: { title: { type: 'string' } },
            },
          },
          {
            uid: 'api::homepage.homepage',
            schema: {
              kind: 'singleType',
              displayName: 'Homepage',
              singularName: 'homepage',
              pluralName: 'homepages',
              attributes: { heroTitle: { type: 'string' } },
            },
          },
          {
            uid: 'plugin::users-permissions.user',
            kind: 'collectionType',
            info: { singularName: 'user', pluralName: 'users', displayName: 'User' },
            options: {},
            attributes: {},
          },
          {
            uid: 'strapi::internal',
            kind: 'collectionType',
            info: { singularName: 'internal', pluralName: 'internals', displayName: 'Internal' },
            options: {},
            attributes: {},
          },
        ],
      }),
    });

    const result = await fetchDynamicCollections('http://localhost:1337', 'valid-jwt');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result!.every((c) => c.uid.startsWith('api::'))).toBe(true);
    expect(result!.find((c) => c.uid === 'api::soham.soham')?.displayName).toBe('Soham');
    expect(result!.find((c) => c.uid === 'api::homepage.homepage')?.kind).toBe('singleType');
  });

  it('returns null on network error without throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await fetchDynamicCollections('http://localhost:1337', 'valid-jwt');
    expect(result).toBeNull();
  });
});
