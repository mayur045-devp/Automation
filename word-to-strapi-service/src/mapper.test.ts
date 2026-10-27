import { describe, it, expect, vi } from 'vitest';
import { ruleBasedMapping, mapDocumentToArticle } from '../src/mapper.js';
import { buildStrapiPayload, validateArticlePayload } from '../src/schema.js';
import { StrapiClient } from '../src/strapiClient.js';
import { diffPayload } from '../src/index.js';
import type { ExtractedDocument } from '../src/extract.js';

function createMockDoc(overrides: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    title: 'Default Title',
    description: 'Default Description',
    slug: null,
    content: null,
    headings: [],
    paragraphs: [],
    lists: [],
    images: [],
    rawText: 'Default Title Default Description',
    metadata: {
      wordCount: 4,
      hasImages: false,
      extractedAt: new Date().toISOString(),
      filename: 'test.docx',
    },
    parsedFields: {},
    ...overrides,
  };
}

describe('Rule-Based and AI Mapping — Field Independence', () => {
  // Requirement 1 & 2:
  // "A document containing a title and description populates only title and description plus any legitimate derived fields."
  // "The main content field remains empty when the document has no main-body content."
  it('populates only title, description, and derived slug when document has no body content', () => {
    const doc = createMockDoc({
      title: 'The Future of Artificial Intelligence',
      description: 'A concise description from the document.',
      content: null,
    });

    const result = ruleBasedMapping(doc);

    expect(result.fields.title).toBe('The Future of Artificial Intelligence');
    expect(result.fields.description).toBe('A concise description from the document.');
    expect(result.fields.slug).toBe('the-future-of-artificial-intelligence');
    expect(result.fields.content).toBeNull();

    // In Strapi payload:
    expect(result.payload.Title).toBe('The Future of Artificial Intelligence');
    expect(result.payload.description).toBe('A concise description from the document.');
    expect(result.payload.slug).toBe('the-future-of-artificial-intelligence');
    expect(result.payload.content).toBeNull();
  });

  // Requirement 3:
  // "A populated main body maps only to the correct content field."
  it('maps populated body content ONLY to content and keeps title and description separate', () => {
    const doc = createMockDoc({
      title: 'Renewable Power Overview',
      description: 'Global shift towards clean electricity.',
      content: '## Solar Energy Trends\n\nSolar panels have reached peak efficiency in 2025.',
    });

    const result = ruleBasedMapping(doc);

    expect(result.fields.title).toBe('Renewable Power Overview');
    expect(result.fields.description).toBe('Global shift towards clean electricity.');
    expect(result.fields.content).toBe('## Solar Energy Trends\n\nSolar panels have reached peak efficiency in 2025.');

    expect(result.payload.Title).toBe('Renewable Power Overview');
    expect(result.payload.description).toBe('Global shift towards clean electricity.');
    expect(result.payload.content).toBe('## Solar Energy Trends\n\nSolar panels have reached peak efficiency in 2025.');
  });

  // Requirement 4:
  // "Missing optional fields do not cause validation failures."
  it('does not fail validation when optional fields are null or omitted', () => {
    const payload = {
      Title: 'Minimal Article',
      slug: null,
      description: null,
      content: null,
    };

    const validation = validateArticlePayload(payload);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(validation.data.Title).toBe('Minimal Article');
      expect(validation.data.content).toBeNull();
      expect(validation.data.description).toBeNull();
    }
  });

  // Requirement 5:
  // "Missing required fields prevent draft creation."
  it('prevents draft creation when a required field is missing', () => {
    const payloadWithoutTitle = {
      Title: null,
      slug: 'some-slug',
      description: 'Some description',
      content: 'Some body content',
    };

    const validation = validateArticlePayload(payloadWithoutTitle, { requiredFields: ['Title'] });
    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.errors[0].message).toContain('Missing required field: Title');
    }
  });

  // Requirement 6:
  // "SEO values map only to their corresponding SEO component properties."
  it('maps SEO values only to defaultSeo properties and never into content', () => {
    const doc = createMockDoc({
      title: 'SEO Optimized Post',
      description: 'An article about SEO optimization.',
      content: '## Main Body\n\nThis is the actual article content.',
      parsedFields: {
        defaultSeo: {
          metaTitle: 'SEO Title for Google',
          metaDescription: 'SEO Meta Description for search results',
          keywords: ['seo', 'google', 'ranking'],
          canonicalURL: 'https://example.com/seo-optimized-post',
          metaRobots: 'index, follow',
          structuredData: '{"@type": "Article"}',
          metaViewPort: 'width=device-width, initial-scale=1',
          shareImage: null,
        },
      },
    });

    const result = ruleBasedMapping(doc);

    expect(result.fields.defaultSeo?.metaTitle).toBe('SEO Title for Google');
    expect(result.fields.defaultSeo?.metaDescription).toBe('SEO Meta Description for search results');
    expect(result.fields.defaultSeo?.keywords).toEqual(['seo', 'google', 'ranking']);
    expect(result.fields.defaultSeo?.canonicalURL).toBe('https://example.com/seo-optimized-post');

    // Content must NOT contain SEO metadata
    expect(result.fields.content).not.toContain('SEO Title for Google');
    expect(result.fields.content).not.toContain('SEO Meta Description');
    expect(result.fields.content).not.toContain('https://example.com/seo-optimized-post');
    expect(result.payload.content).toBe('## Main Body\n\nThis is the actual article content.');
  });

  // Requirement 7:
  // "FAQ, button, author, category, form, and date data never get accidentally concatenated into content."
  it('never concatenates FAQ, button, author, category, form, and date into content', () => {
    const doc = createMockDoc({
      title: 'Feature Release',
      description: 'Summary of new features.',
      content: '## Feature Details\n\nDetailed breakdown of new features.',
      parsedFields: {
        authordata: 'Jane Doe, Lead Engineer',
        date: '2026-10-26',
        categoryname: 'Engineering',
        blogcategories: ['Tech', 'Engineering'],
        button: 'Get Started',
        buttontitle: 'Start Free Trial',
        buttonsubtitle: 'No credit card required',
        faqsection: 'Q: How do I upgrade? A: Click upgrade in dashboard.',
        formsection: 'Form: Contact Sales',
        time: '5 min read',
        popularityname: 'Trending',
      },
    });

    const result = ruleBasedMapping(doc);

    // Each field mapped independently
    expect(result.fields.authordata).toBe('Jane Doe, Lead Engineer');
    expect(result.fields.date).toBe('2026-10-26');
    expect(result.fields.categoryname).toBe('Engineering');
    expect(result.fields.blogcategories).toEqual(['Tech', 'Engineering']);
    expect(result.fields.button).toBe('Get Started');
    expect(result.fields.buttontitle).toBe('Start Free Trial');
    expect(result.fields.buttonsubtitle).toBe('No credit card required');
    expect(result.fields.faqsection).toContain('How do I upgrade?');
    expect(result.fields.formsection).toBe('Form: Contact Sales');
    expect(result.fields.time).toBe('5 min read');
    expect(result.fields.popularityname).toBe('Trending');

    // NONE of them in content!
    expect(result.fields.content).toBe('## Feature Details\n\nDetailed breakdown of new features.');
    expect(result.fields.content).not.toContain('Jane Doe');
    expect(result.fields.content).not.toContain('2026-10-26');
    expect(result.fields.content).not.toContain('Engineering');
    expect(result.fields.content).not.toContain('Start Free Trial');
    expect(result.fields.content).not.toContain('How do I upgrade?');
    expect(result.fields.content).not.toContain('Contact Sales');
  });

  // Requirement 8:
  // "Empty image placeholders do not become media references."
  it('treats text image placeholders as null cover and does not invent media IDs', () => {
    const doc = createMockDoc({
      title: 'Article With Image Placeholder',
      description: 'Article description.',
      content: '## Section\n\nBody text.',
      parsedFields: {
        cover: null, // text like [Optional cover photo: ...] was parsed as placeholder
      },
      images: [], // no real binary image assets
    });

    const result = ruleBasedMapping(doc);

    expect(result.fields.cover).toBeNull();
    expect(result.missingFields).toContain('coverImage (no images in document)');
    // In Strapi draft payload, coverImage is not sent as a string placeholder
    expect((result.payload as any).coverImage).toBeUndefined();
  });

  // Requirement 9:
  // "Component and relation values conform to the real Strapi schema."
  it('conforms to the inspected Strapi 5 schema without sending unsupported fields', () => {
    const fields = {
      title: 'Valid Strapi Article',
      description: 'Valid description',
      slug: 'valid-strapi-article',
      cover: null,
      defaultSeo: {
        metaTitle: 'Title',
        metaDescription: 'Desc',
        keywords: ['tag'],
        metaRobots: null,
        structuredData: null,
        metaViewPort: null,
        canonicalURL: null,
        shareImage: null,
      },
      content: '## Body Text\n\nValid body.',
      date: '2026-10-26',
      authordata: 'Author',
      faqsection: 'FAQ',
    };

    const payload = buildStrapiPayload(fields);

    // Conforms strictly to my-strapi/src/api/article/content-types/article/schema.json:
    // Attributes: Title, slug, description, content
    expect(Object.keys(payload).sort()).toEqual(['Title', 'content', 'description', 'slug']);
    expect(payload.Title).toBe('Valid Strapi Article');
    expect(payload.slug).toBe('valid-strapi-article');
    expect(payload.description).toBe('Valid description');
    expect(payload.content).toBe('## Body Text\n\nValid body.');
  });

  it('correctly maps Blog Content Entry Template data: Title from "1. Title", not "Blog Details", and content remains clean', () => {
    const doc = createMockDoc({
      title: 'How AI Is Transforming Digital Business',
      description: 'Explore how businesses can use artificial intelligence to improve operations, personalize customer experiences, and make more informed decisions.',
      slug: 'how-ai-is-transforming-digital-business',
      content: null,
      parsedFields: {
        title: 'How AI Is Transforming Digital Business',
        description: 'Explore how businesses can use artificial intelligence to improve operations, personalize customer experiences, and make more informed decisions.',
        slug: 'how-ai-is-transforming-digital-business',
        cover: null,
        defaultSeo: {
          metaTitle: 'How AI Is Transforming Digital Business | 12th Wonder',
          metaDescription: 'Learn how AI can help businesses streamline operations, personalize customer experiences, and support smarter decisions.',
          keywords: [],
          metaRobots: 'index, follow',
          structuredData: null,
          metaViewPort: null,
          canonicalURL: null,
          shareImage: null,
        },
      },
    });

    const result = ruleBasedMapping(doc);

    // Verified: Title is NOT "Blog Details"
    expect(result.payload.Title).toBe('How AI Is Transforming Digital Business');
    expect(result.payload.Title).not.toBe('Blog Details');

    // Verified: Description is the actual summary, not the template disclaimer
    expect(result.payload.description).toBe(
      'Explore how businesses can use artificial intelligence to improve operations, personalize customer experiences, and make more informed decisions.'
    );

    // Verified: Slug is derived from the real title, not "blog-details"
    expect(result.payload.slug).toBe('how-ai-is-transforming-digital-business');
    expect(result.payload.slug).not.toBe('blog-details');

    // Verified: Content does NOT receive section headings or template headers
    expect(result.payload.content).toBeNull();

    // Verified: SEO is extracted into fields.defaultSeo
    expect(result.fields.defaultSeo?.metaTitle).toBe('How AI Is Transforming Digital Business | 12th Wonder');
    expect(result.fields.defaultSeo?.metaDescription).toContain('Learn how AI can help businesses');
  });
});

describe('Strapi Client and Duplicate Prevention', () => {
  // Requirement 10:
  // "Repeated confirmation or retry does not create duplicate entries."
  it('detects existing duplicate draft by title before creating draft', async () => {
    const client = new StrapiClient('http://localhost:1337', 'mock-token');

    // Mock fetch to return existing article
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 42, documentId: 'doc_existing_123', Title: 'Existing Title' }],
        }),
      } as any;
    });

    const existing = await client.findByTitle('Existing Title');
    expect(existing).not.toBeNull();
    expect(existing?.documentId).toBe('doc_existing_123');
    expect(existing?.id).toBe(42);
  });

  it('creates draft only when no duplicate exists', async () => {
    const client = new StrapiClient('http://localhost:1337', 'mock-token');

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.data.Title).toBe('New Unique Title');
      expect(init.method).toBe('POST');
      expect(url.toString()).toContain('/api/articles?status=draft');

      return {
        ok: true,
        json: async () => ({
          data: { id: 99, documentId: 'doc_new_99', Title: 'New Unique Title' },
        }),
      } as any;
    });

    const created = await client.createDraft({
      Title: 'New Unique Title',
      slug: 'new-unique-title',
      description: 'Desc',
      content: null,
    });

    expect(created.documentId).toBe('doc_new_99');
    expect(created.id).toBe(99);
  });

  // Requirement 11:
  // "The verified saved draft matches the approved field-by-field payload."
  it('correctly verifies saved draft against approved field-by-field payload', () => {
    const approvedPayload = {
      Title: 'My Article',
      slug: 'my-article',
      description: 'Summary',
      content: null,
    };

    const savedFromStrapiMatching = {
      Title: 'My Article',
      slug: 'my-article',
      description: 'Summary',
      content: null,
    };

    const mismatches = diffPayload(approvedPayload, savedFromStrapiMatching);
    expect(mismatches).toHaveLength(0);

    const savedFromStrapiWithMismatch = {
      Title: 'My Article',
      slug: 'different-slug',
      description: 'Summary',
      content: 'Unexpected Content',
    };

    const diffs = diffPayload(approvedPayload, savedFromStrapiWithMismatch);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.includes('slug'))).toBe(true);
    expect(diffs.some((d) => d.includes('content'))).toBe(true);
  });
});
