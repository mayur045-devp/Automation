import { describe, it, expect } from 'vitest';
import {
  validateArticlePayload,
  slugify,
  buildStrapiPayload,
  DocumentFieldsSchema,
} from '../src/schema.js';

describe('validateArticlePayload', () => {
  it('accepts a valid payload', () => {
    const result = validateArticlePayload({
      Title: 'My Article',
      slug: 'my-article',
      description: 'Short summary.',
      content: 'Full article body.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty payload (all fields optional)', () => {
    const result = validateArticlePayload({});
    expect(result.success).toBe(true);
  });

  it('accepts explicit nulls for optional fields', () => {
    const result = validateArticlePayload({
      Title: null,
      slug: null,
      description: null,
      content: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects Title longer than 255 characters', () => {
    const result = validateArticlePayload({ Title: 'a'.repeat(256) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.includes('Title'))).toBe(true);
    }
  });

  it('rejects a slug with spaces', () => {
    const result = validateArticlePayload({ Title: 'Test', slug: 'my article slug' });
    expect(result.success).toBe(false);
  });

  it('rejects a slug with uppercase', () => {
    const result = validateArticlePayload({ Title: 'Test', slug: 'My-Slug' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid lowercase-hyphenated slug', () => {
    const result = validateArticlePayload({ slug: 'the-future-of-energy' });
    expect(result.success).toBe(true);
  });

  it('rejects description longer than 1000 characters', () => {
    const result = validateArticlePayload({ description: 'a'.repeat(1001) });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field when requiredFields option is provided', () => {
    const result = validateArticlePayload(
      { description: 'A description', content: null },
      { requiredFields: ['Title'] }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.message.includes('Missing required field: Title'))).toBe(true);
    }
  });

  it('passes required field check when required field is provided', () => {
    const result = validateArticlePayload(
      { Title: 'Valid Title', description: null },
      { requiredFields: ['Title'] }
    );
    expect(result.success).toBe(true);
  });
});

describe('slugify', () => {
  it('converts spaces to hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello, World! 2025')).toBe('hello-world-2025');
  });

  it('handles multiple spaces/hyphens', () => {
    expect(slugify('  My  Article --Title  ')).toBe('my-article-title');
  });

  it('truncates at 128 characters', () => {
    expect(slugify('a '.repeat(100)).length).toBeLessThanOrEqual(128);
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('buildStrapiPayload', () => {
  it('builds payload matching real Strapi schema attributes', () => {
    const payload = buildStrapiPayload({
      title: 'The Future of Renewable Energy',
      description: 'An in-depth look at renewables.',
      slug: null,
      content: '## Solar Energy\n\nSolar is booming.',
      authordata: 'John Doe',
      faqsection: 'Q: What is solar? A: Sun power.',
      date: '2026-10-26',
    });

    expect(payload).toEqual({
      Title: 'The Future of Renewable Energy',
      description: 'An in-depth look at renewables.',
      slug: 'the-future-of-renewable-energy',
      content: '## Solar Energy\n\nSolar is booming.',
    });
    // Unmapped document fields are NOT included in the Strapi payload
    expect((payload as any).authordata).toBeUndefined();
    expect((payload as any).faqsection).toBeUndefined();
    expect((payload as any).date).toBeUndefined();
  });

  it('keeps content as null when document has no body content', () => {
    const payload = buildStrapiPayload({
      title: 'Title Only',
      description: 'Summary only',
      slug: null,
      content: null,
    });

    expect(payload.content).toBeNull();
    expect(payload.Title).toBe('Title Only');
    expect(payload.description).toBe('Summary only');
    expect(payload.slug).toBe('title-only');
  });
});

describe('DocumentFieldsSchema', () => {
  it('validates complete independent fields mapping contract', () => {
    const data = {
      title: 'Test Article',
      description: 'Test description',
      slug: 'test-article',
      cover: null,
      defaultSeo: {
        metaTitle: 'SEO Meta Title',
        metaDescription: 'SEO Description',
        keywords: ['tech', 'ai'],
        metaRobots: 'index, follow',
        structuredData: null,
        metaViewPort: null,
        canonicalURL: 'https://example.com/article',
        shareImage: null,
      },
      content: null,
      date: '2026-10-26',
      authordata: 'Jane Doe',
      categoryname: 'Technology',
      contentnew: null,
      button: 'Learn More',
      buttontitle: 'Read Article',
      buttonsubtitle: '5 min read',
      blogcategories: ['Tech', 'News'],
      time: '5 min',
      faqsection: [{ question: 'What is this?', answer: 'A test' }],
      formsection: null,
      popularityname: 'Trending',
    };

    const parsed = DocumentFieldsSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });
});
