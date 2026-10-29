import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDynamicCollectionsCache,
  getImportableCollections,
  getImportCollection,
  setDynamicCollectionsCache,
  validateConnectionOrigin,
  validateImportPayload,
} from './collections';
import type { DynamicImportCollection } from './dynamicCollections';

const originalCollectionSetting = process.env.STRAPI_IMPORT_COLLECTIONS;

afterEach(() => {
  clearDynamicCollectionsCache();
  if (originalCollectionSetting === undefined) {
    delete process.env.STRAPI_IMPORT_COLLECTIONS;
  } else {
    process.env.STRAPI_IMPORT_COLLECTIONS = originalCollectionSetting;
  }
});

describe('verified Strapi import collections', () => {
  it('lists only the verified Article and Blog targets by default', () => {
    delete process.env.STRAPI_IMPORT_COLLECTIONS;
    expect(getImportableCollections().map((collection) => collection.uid)).toEqual([
      'api::article.article',
      'api::blog.blog',
    ]);
  });

  it('restricts targets to configured verified UIDs and rejects arbitrary values', () => {
    process.env.STRAPI_IMPORT_COLLECTIONS = 'api::blog.blog,api::external.external';
    expect(getImportableCollections().map((collection) => collection.uid)).toEqual(['api::blog.blog']);
    expect(getImportCollection('api::external.external')).toBeUndefined();
    expect(getImportCollection({ uid: 'api::blog.blog' })).toBeUndefined();
  });

  it('uses the refreshed live list as authoritative and includes newly discovered types', () => {
    const makeLiveType = (uid: string, name: string, kind: DynamicImportCollection['kind']): DynamicImportCollection => ({
      uid,
      displayName: name,
      apiName: name.toLowerCase(),
      kind,
      graphqlFields: [name.toLowerCase()],
      draftAndPublish: false,
      mapper: 'scalar',
      fields: [],
      dynamic: true,
    });

    setDynamicCollectionsCache([makeLiveType('api::soham.soham', 'Soham', 'collectionType')]);
    expect(getImportableCollections().map((collection) => collection.uid)).toEqual(['api::soham.soham']);

    setDynamicCollectionsCache([
      makeLiveType('api::soham.soham', 'Soham', 'collectionType'),
      makeLiveType('api::homepage.homepage', 'Homepage', 'singleType'),
    ]);
    expect(getImportableCollections().map((collection) => collection.uid)).toEqual([
      'api::soham.soham',
      'api::homepage.homepage',
    ]);
    expect(getImportCollection('api::homepage.homepage')?.kind).toBe('singleType');
  });

  it('treats an empty content-type allowlist as unrestricted live discovery', () => {
    process.env.STRAPI_IMPORT_COLLECTIONS = '';
    const liveType: DynamicImportCollection = {
      uid: 'api::soham.soham',
      displayName: 'Soham',
      apiName: 'sohams',
      kind: 'collectionType',
      graphqlFields: [],
      draftAndPublish: false,
      mapper: 'scalar',
      fields: [],
      dynamic: true,
    };
    setDynamicCollectionsCache([liveType]);

    expect(getImportableCollections().map((collection) => collection.uid)).toEqual(['api::soham.soham']);
  });

  it('accepts only the configured Strapi origin, not a browser-supplied destination', () => {
    expect(validateConnectionOrigin('http://localhost:1337', 'http://localhost:1337')).toBe(true);
    expect(validateConnectionOrigin('https://elsewhere.example', 'http://localhost:1337')).toBe(false);
    expect(validateConnectionOrigin('http://localhost:1337/path', 'http://localhost:1337')).toBe(false);
    expect(validateConnectionOrigin('http://user:pass@localhost:1337', 'http://localhost:1337')).toBe(false);
  });

  it('validates Blog scalar values against the verified target schema', () => {
    const blog = getImportCollection('api::blog.blog');
    expect(blog).toBeDefined();
    expect(validateImportPayload(blog!, {
      title: 'A Blog Entry',
      description: 'A short description',
      content: 'The full body',
    }).success).toBe(true);

    const invalid = validateImportPayload(blog!, {
      title: 42,
      unknownDestination: 'not allowed',
    });
    expect(invalid.success).toBe(false);
  });

  it('reports absent required fields and unsupported relations', () => {
    const blog = getImportCollection('api::blog.blog')!;
    const requiredBlog = {
      ...blog,
      fields: blog.fields.map((field) => ({ ...field, required: field.name === 'title' })),
    };
    const validation = validateImportPayload(requiredBlog, {});
    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.errors).toContain('Missing required field: title');

    const article = getImportCollection('api::article.article')!;
    expect(article.fields.find((field) => field.name === 'tital_blog_category')?.supported).toBe(false);
  });

  it('validates nested required fields, enums, dates, and JSON against collection metadata', () => {
    const blog = getImportCollection('api::blog.blog')!;
    const target = {
      ...blog,
      fields: [
        {
          name: 'details',
          type: 'component',
          required: true,
          supported: true,
          componentFields: [
            { name: 'status', type: 'enumeration', enumValues: ['draft', 'published'], required: true, supported: true },
            { name: 'publishedOn', type: 'date', required: false, supported: true },
            { name: 'metadata', type: 'json', required: false, supported: true },
          ],
        },
      ],
    };

    expect(validateImportPayload(target, {}).success).toBe(false);
    expect(validateImportPayload(target, {
      details: { status: 'published', publishedOn: '2026-03-08', metadata: { source: 'docx' } },
    }).success).toBe(true);
    expect(validateImportPayload(target, {
      details: { status: 'archived' },
    }).success).toBe(false);
    expect(validateImportPayload(target, {
      details: { status: 'draft', publishedOn: '2026-02-31' },
    }).success).toBe(false);
  });
});
