import { describe, it, expect, vi } from 'vitest';
import { SchemaType } from '@google/generative-ai';
import {
  toGeminiSchema,
  AI_OUTPUT_GEMINI_SCHEMA,
  textToBlocks,
  buildStrapiPayload,
  DocumentFieldsSchema,
} from './schema';
import { mapDocumentToArticle, mapDocumentToCollection, ruleBasedMapping } from './mapper';
import { extractDocx } from './extract';
import { compareDocumentSchema, analyzeDocumentForSchema } from './schemaAnalyzer';
import { getImportCollection } from './collections';
import type { ExtractedDocument } from './extract';

describe('Gemini Schema Generation and Validation (Fix for 400 Bad Request)', () => {
  it('generates schema adhering strictly to Google Generative AI OpenAPI 3.0 schema', () => {
    const geminiSchema = toGeminiSchema({
      type: ['string', 'null'],
      description: 'Test string or null',
    });

    expect(geminiSchema.type).toBe(SchemaType.STRING);
    expect((geminiSchema as any).nullable).toBe(true);
    expect(Array.isArray(geminiSchema.type)).toBe(false);
  });

  it('converts complex nested object schemas with arrays and nullables correctly', () => {
    const inputSchema = {
      type: ['object', 'null'],
      properties: {
        title: { type: ['string', 'null'] },
        keywords: {
          type: 'array',
          items: { type: 'string' },
        },
        meta: {
          type: 'object',
          properties: {
            description: { type: ['string', 'null'] },
          },
        },
      },
      required: ['title'],
    };

    const result = toGeminiSchema(inputSchema);

    expect(result.type).toBe(SchemaType.OBJECT);
    expect((result as any).nullable).toBe(true);
    expect(result.properties?.title.type).toBe(SchemaType.STRING);
    expect((result.properties?.title as any).nullable).toBe(true);
    expect(result.properties?.keywords.type).toBe(SchemaType.ARRAY);
    expect(result.properties?.keywords.items?.type).toBe(SchemaType.STRING);
    expect(result.properties?.meta.type).toBe(SchemaType.OBJECT);
    expect(result.properties?.meta.properties?.description.type).toBe(SchemaType.STRING);
    expect((result.properties?.meta.properties?.description as any).nullable).toBe(true);
  });

  it('AI_OUTPUT_GEMINI_SCHEMA has no invalid array type definitions', () => {
    const validateNode = (node: any, path: string = '') => {
      if (!node || typeof node !== 'object') return;
      if ('type' in node) {
        expect(
          typeof node.type === 'string' && !Array.isArray(node.type),
          `Property at ${path} has invalid type: ${JSON.stringify(node.type)}`
        ).toBe(true);
      }
      if (node.properties) {
        for (const [key, child] of Object.entries(node.properties)) {
          validateNode(child, `${path}.${key}`);
        }
      }
      if (node.items) {
        validateNode(node.items, `${path}[]`);
      }
    };

    validateNode(AI_OUTPUT_GEMINI_SCHEMA, 'root');
  });
});

describe('Blocks Content Conversion', () => {
  it('converts multiline text into Strapi 5 paragraph blocks', () => {
    const text = 'Paragraph 1\n\nParagraph 2 with more details.';
    const blocks = textToBlocks(text);

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Paragraph 1' }],
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Paragraph 2 with more details.' }],
      },
    ]);
  });

  it('converts markdown headings into heading blocks with correct levels', () => {
    const text = '# Main Header\n\n## Sub Header\n\nRegular text.';
    const blocks = textToBlocks(text);

    expect(blocks).toEqual([
      {
        type: 'heading',
        level: 1,
        children: [{ type: 'text', text: 'Main Header' }],
      },
      {
        type: 'heading',
        level: 2,
        children: [{ type: 'text', text: 'Sub Header' }],
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Regular text.' }],
      },
    ]);
  });

  it('converts lists into Strapi list blocks', () => {
    const text = '- Item 1\n- Item 2\n- Item 3';
    const blocks = textToBlocks(text);

    expect(blocks).toEqual([
      {
        type: 'list',
        format: 'unordered',
        children: [
          { type: 'list-item', children: [{ type: 'text', text: 'Item 1' }] },
          { type: 'list-item', children: [{ type: 'text', text: 'Item 2' }] },
          { type: 'list-item', children: [{ type: 'text', text: 'Item 3' }] },
        ],
      },
    ]);
  });
});

describe('Full 18-Field Document Regression (blog_content_entry_sample_2)', () => {
  it('extracts and maps all fields from sample template without losing data or polluting body', async () => {
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, Packer } = await import('docx');

    const sampleDoc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Blog Content Entry Template', heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Title')] }), new TableCell({ children: [new Paragraph('How AI Is Transforming Digital Business')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Description')] }), new TableCell({ children: [new Paragraph('An overview of AI applications in business.')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Slug')] }), new TableCell({ children: [new Paragraph('how-ai-is-transforming-digital-business')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Cover')] }), new TableCell({ children: [new Paragraph('Leave empty — select in Strapi')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('metaTitle')] }), new TableCell({ children: [new Paragraph('How AI Transforms Business | SEO Title')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('metaDescription')] }), new TableCell({ children: [new Paragraph('SEO Meta Description details.')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('keywords')] }), new TableCell({ children: [new Paragraph('AI, Automation, Cloud')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('metaRobots')] }), new TableCell({ children: [new Paragraph('index, follow')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('structuredData')] }), new TableCell({ children: [new Paragraph('{"@type":"Article"}')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('metaViewPort')] }), new TableCell({ children: [new Paragraph('width=device-width, initial-scale=1')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('canonicalURL')] }), new TableCell({ children: [new Paragraph('https://example.com/ai-article')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('shareImage')] }), new TableCell({ children: [new Paragraph('Leave empty')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Content')] }), new TableCell({ children: [new Paragraph('This is the main article content body describing AI workflows in detail.')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Date')] }), new TableCell({ children: [new Paragraph('2026-10-26')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('authordata')] }), new TableCell({ children: [new Paragraph('Jane Doe')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('categoryname')] }), new TableCell({ children: [new Paragraph('Digital Transformation')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('contentnew')] }), new TableCell({ children: [new Paragraph('Supplementary rich content section.')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('button')] }), new TableCell({ children: [new Paragraph('https://example.com/learn-more')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('buttontitle')] }), new TableCell({ children: [new Paragraph('Explore Services')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('buttonsubtitle')] }), new TableCell({ children: [new Paragraph('Click to discover more.')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('blogcategories')] }), new TableCell({ children: [new Paragraph('Leave empty — select category relation')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('time')] }), new TableCell({ children: [new Paragraph('5 min read')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('faqsection')] }), new TableCell({ children: [new Paragraph('Leave empty — add FAQ items')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('formsection')] }), new TableCell({ children: [new Paragraph('Leave empty — connect form')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('popularityname')] }), new TableCell({ children: [new Paragraph('Trending')] })] }),
            ],
          }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(sampleDoc);
    const doc = await extractDocx(buffer, 'blog_content_entry_sample_2.docx');

    // 1. Structural extraction
    expect(doc.title).toBe('How AI Is Transforming Digital Business');
    expect(doc.description).toBe('An overview of AI applications in business.');
    expect(doc.slug).toBe('how-ai-is-transforming-digital-business');
    expect(doc.parsedFields.date).toBe('2026-10-26');
    expect(doc.parsedFields.authordata).toBe('Jane Doe');
    expect(doc.parsedFields.categoryname).toBe('Digital Transformation');
    expect(doc.parsedFields.buttontitle).toBe('Explore Services');
    expect(doc.parsedFields.buttonsubtitle).toBe('Click to discover more.');
    expect(doc.parsedFields.time).toBe('5 min read');
    expect(doc.parsedFields.popularityname).toBe('Trending');

    // 2. Instructions vs Real content
    expect(doc.fieldStates.cover.status).toBe('unresolved');
    expect(doc.fieldStates.blogcategories.status).toBe('unresolved');
    expect(doc.fieldStates.faqsection.status).toBe('unresolved');
    expect(doc.fieldStates.formsection.status).toBe('unresolved');

    // 3. Schema reconciliation
    const articleCollection = getImportCollection('api::article.article')!;
    const diff = compareDocumentSchema(doc, articleCollection);

    // popularityname is correctly detected as a missing scalar field needing schema approval
    expect(diff.missingFields.some((f) => f.name === 'popularityname')).toBe(true);

    // 4. Mapped Payload
    const mapped = ruleBasedMapping(doc);
    expect(mapped.payload.Title).toBe('How AI Is Transforming Digital Business');
    expect(mapped.payload.slug).toBe('how-ai-is-transforming-digital-business');
    expect(mapped.payload.description).toBe('An overview of AI applications in business.');
    expect(mapped.payload.content).toBe('This is the main article content body describing AI workflows in detail.');
    expect(mapped.payload.date).toBe('2026-10-26');
    expect(mapped.payload.categoryName).toBe('Digital Transformation');
    expect(mapped.payload.buttontitle).toBe('Explore Services');
    expect(mapped.payload.buttonsubtitle).toBe('Click to discover more.');
    expect(mapped.payload.time).toBe('5 min read');
    expect(mapped.payload.button).toEqual({ link: 'https://example.com/learn-more' });
    expect(mapped.payload.contentNew).toEqual([
      {
        content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Supplementary rich content section.' }] }],
      },
    ]);
    expect(mapped.payload.seo).toEqual({
      metaTitle: 'How AI Transforms Business | SEO Title',
      metaDescription: 'SEO Meta Description details.',
      keywords: 'AI, Automation, Cloud',
      metaRobots: 'index, follow',
      structuredData: '{"@type":"Article"}',
      metaViewport: 'width=device-width, initial-scale=1',
      canonicalURL: 'https://example.com/ai-article',
    });
  });
});

