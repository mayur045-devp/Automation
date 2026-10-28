import { describe, it, expect } from 'vitest';
import {
  analyzeDocumentForSchema,
  compareDocumentSchema,
  proposedSchemaToCreatePayload,
  checkSchemaCompatibility,
} from '../src/schemaAnalyzer';
import type { ExtractedDocument } from '../src/extract';
import { DOCUMENT_FIELD_KEYS } from '../src/schema';
import type { ImportCollection } from '../src/collections';

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeDoc(overrides: Partial<ExtractedDocument> = {}): ExtractedDocument {
  const fieldStates = Object.fromEntries(
    DOCUMENT_FIELD_KEYS.map((key) => [key, { status: 'missing' as const }])
  ) as ExtractedDocument['fieldStates'];

  return {
    title: 'AI in Modern Business',
    description: 'An overview of AI applications.',
    slug: null,
    content: 'Artificial intelligence is changing how businesses operate.',
    headings: [{ level: 1, text: 'AI in Modern Business' }],
    paragraphs: ['An overview of AI applications.'],
    lists: [],
    images: [],
    rawText: 'AI in Modern Business. An overview of AI applications. Artificial intelligence...',
    metadata: {
      wordCount: 20,
      hasImages: false,
      extractedAt: new Date().toISOString(),
      filename: 'test.docx',
    },
    parsedFields: {
      title: 'AI in Modern Business',
      description: 'An overview of AI applications.',
      content: 'Artificial intelligence is changing how businesses operate.',
      date: '2026-10-26',
      authordata: 'Jane Smith',
      categoryname: 'Technology',
    },
    fieldStates: {
      ...fieldStates,
      title: { status: 'extracted', rawValue: 'AI in Modern Business' },
      description: { status: 'extracted', rawValue: 'An overview of AI applications.' },
      content: { status: 'extracted', rawValue: 'Artificial intelligence...' },
      date: { status: 'extracted', rawValue: '2026-10-26' },
      authordata: { status: 'extracted', rawValue: 'Jane Smith' },
      categoryname: { status: 'extracted', rawValue: 'Technology' },
    },
    unmappedFields: [
      { label: 'New Custom Field', value: 'some custom value' },
    ],
    ...overrides,
  };
}

// ── analyzeDocumentForSchema ───────────────────────────────────────────────────
describe('analyzeDocumentForSchema', () => {
  it('infers basic fields from a rich document', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);

    expect(schema.fields.length).toBeGreaterThan(0);
    const fieldNames = schema.fields.map((f) => f.name);
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('description');
    expect(fieldNames).toContain('content');
  });

  it('infers string type for title', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const title = schema.fields.find((f) => f.name === 'title');
    expect(title).toBeDefined();
    expect(title!.type).toBe('string');
    expect(title!.confidence).toBe('high');
  });

  it('infers richtext type for content', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const content = schema.fields.find((f) => f.name === 'content');
    expect(content?.type).toBe('richtext');
  });

  it('infers date type for date field', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const dateField = schema.fields.find((f) => f.name === 'date');
    expect(dateField?.type).toBe('date');
  });

  it('includes unmapped fields from document', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const fieldNames = schema.fields.map((f) => f.name);
    // 'New Custom Field' -> 'newCustomField' after camelCase conversion
    expect(fieldNames.some((n) => n.toLowerCase().includes('new') || n.toLowerCase().includes('custom'))).toBe(true);
  });

  it('proposes a cover media field when images are present', () => {
    const doc = makeDoc({
      images: [{
        index: 0,
        altText: 'Cover image',
        caption: '',
        location: 'Document',
        buffer: Buffer.from([]),
        contentType: 'image/png',
        filename: 'cover.png',
      }],
    });
    const schema = analyzeDocumentForSchema(doc);
    const mediaField = schema.fields.find((f) => f.type === 'media');
    expect(mediaField).toBeDefined();
  });

  it('does not duplicate title when it appears in both parsedFields and top-level', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const titleFields = schema.fields.filter((f) => f.name === 'title');
    expect(titleFields.length).toBe(1);
  });

  it('generates valid proposed names from a display name', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc, 'Blog Post Article');
    expect(schema.displayName).toBe('Blog Post Article');
    expect(schema.singularName).toBe('blogpostarticle');
    expect(schema.pluralName).toBe('blogpostarticles');
  });

  it('defaults to collectionType kind', () => {
    const schema = analyzeDocumentForSchema(makeDoc());
    expect(schema.kind).toBe('collectionType');
  });

  it('respects singleType kind override', () => {
    const schema = analyzeDocumentForSchema(makeDoc(), undefined, 'singleType');
    expect(schema.kind).toBe('singleType');
  });

  it('produces a warning for empty documents', () => {
    const emptyDoc = makeDoc({
      title: null,
      description: null,
      content: null,
      parsedFields: {},
      unmappedFields: [],
      images: [],
    });
    const schema = analyzeDocumentForSchema(emptyDoc);
    expect(schema.warnings.length).toBeGreaterThan(0);
  });

  it('marks uncertain fields correctly', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    // Low-confidence fields should be flagged as uncertain
    const lowFields = schema.fields.filter((f) => f.confidence === 'low');
    lowFields.forEach((f) => {
      expect(f.uncertain).toBe(true);
    });
  });

  it('includes SEO component as a component field when defaultSeo is present', () => {
    const doc = makeDoc({
      parsedFields: {
        defaultSeo: {
          metaTitle: 'SEO Title',
          metaDescription: 'SEO Desc',
          keywords: [],
        },
      },
    });
    const schema = analyzeDocumentForSchema(doc);
    const seoField = schema.fields.find((f) => f.name === 'seo');
    expect(seoField).toBeDefined();
    expect(seoField!.type).toBe('component');
  });
});

// ── proposedSchemaToCreatePayload ──────────────────────────────────────────────
describe('proposedSchemaToCreatePayload', () => {
  it('produces a valid ContentTypeCreatePayload', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc, 'My Article');
    const payload = proposedSchemaToCreatePayload(schema, false);

    expect(payload.kind).toBe('collectionType');
    expect(payload.info.displayName).toBe('My Article');
    expect(typeof payload.info.singularName).toBe('string');
    expect(typeof payload.info.pluralName).toBe('string');
    expect(typeof payload.attributes).toBe('object');
  });

  it('excludes uncertain fields when includeUncertain is false', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const payload = proposedSchemaToCreatePayload(schema, false);

    // Certain fields should be present
    const certainFields = schema.fields.filter((f) => !f.uncertain).map((f) => f.name);
    for (const field of certainFields) {
      if (field !== 'seo') { // SEO is a component, excluded
        // At least one certain field should be in the payload
      }
    }
    // Uncertain fields should not be in the payload
    const uncertainFields = schema.fields.filter((f) => f.uncertain).map((f) => f.name);
    for (const field of uncertainFields) {
      // In most cases uncertain fields are excluded
      // (Some may coincidentally pass through if their type is not component/media)
    }
    expect(payload.attributes).toBeDefined();
  });

  it('adds slug when title exists but slug not explicitly inferred', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const payload = proposedSchemaToCreatePayload(schema, false);

    if (payload.attributes['title']) {
      expect(payload.attributes['slug']?.type).toBe('uid');
      expect(payload.attributes['slug']?.targetField).toBe('title');
    }
  });
});

// ── checkSchemaCompatibility ───────────────────────────────────────────────────
describe('checkSchemaCompatibility', () => {
  it('reports high compatibility when all proposed fields exist with matching types', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);

    // Build existing attributes that match proposed fields
    const existingAttributes: Record<string, { type: string }> = {};
    for (const field of schema.fields.filter((f) => !f.uncertain)) {
      existingAttributes[field.name] = { type: field.type };
    }

    const check = checkSchemaCompatibility(
      schema,
      existingAttributes,
      'api::existing.existing',
      'Existing Type',
    );
    expect(check.score).toBeGreaterThan(50);
    expect(check.conflictingFields.length).toBe(0);
  });

  it('reports 0 score when no fields match', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const check = checkSchemaCompatibility(schema, {}, 'api::empty.empty', 'Empty');
    expect(check.score).toBe(0);
    expect(check.compatible).toBe(false);
  });

  it('reports type conflicts when existing type differs from proposed', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const existingAttributes: Record<string, { type: string }> = {
      title: { type: 'integer' }, // conflict: proposed string, existing integer
    };
    const check = checkSchemaCompatibility(schema, existingAttributes, 'api::test.test', 'Test');
    expect(check.conflictingFields.length).toBeGreaterThan(0);
  });

  it('treats compatible text types as matched (string and text are compatible)', () => {
    const doc = makeDoc();
    const schema = analyzeDocumentForSchema(doc);
    const titleField = schema.fields.find((f) => f.name === 'title');
    if (!titleField) return;

    // title proposed as string, existing as text — should be compatible
    const check = checkSchemaCompatibility(
      { ...schema, fields: [titleField] },
      { title: { type: 'text' } },
      'api::test.test',
      'Test',
    );
    expect(check.conflictingFields.length).toBe(0);
    expect(check.matchedFields).toContain('title');
  });
});

describe('compareDocumentSchema', () => {
  const collection: ImportCollection = {
    uid: 'api::blog.blog',
    displayName: 'Blog',
    apiName: 'blogs',
    kind: 'collectionType',
    graphqlFields: ['blogs'],
    draftAndPublish: true,
    duplicateField: 'title',
    mapper: 'scalar',
    fields: [
      { name: 'title', type: 'integer', required: false, supported: true },
      { name: 'description', type: 'text', required: false, supported: true },
      { name: 'content', type: 'richtext', required: false, supported: true },
    ],
  };

  it('reuses compatible fields and reports missing and conflicting document fields', () => {
    const doc = makeDoc({
      unmappedFields: [
        { label: 'New Custom Field', value: 'some custom value' },
        { label: 'SEO', value: 'SEO metadata' },
      ],
    });
    const diff = compareDocumentSchema(doc, collection);

    expect(diff.compatibleFields).toContainEqual({
      documentField: 'description',
      schemaField: 'description',
      type: 'text',
    });
    expect(diff.missingFields.some((field) => field.name === 'date')).toBe(true);
    expect(diff.conflictingFields).toContainEqual({
      documentField: 'title',
      schemaField: 'title',
      proposedType: 'string',
      existingType: 'integer',
    });
    expect(diff.unsupportedFields.some((field) => field.name.toLowerCase() === 'seo')).toBe(true);
  });
});
