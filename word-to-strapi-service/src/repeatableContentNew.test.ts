import { describe, it, expect } from 'vitest';
import {
  textToBlocks,
  parseSectionsFromText,
  parseMarkdownHeadingSections,
  validateStrapiBlocks,
  validateArticlePayload,
  buildStrapiPayload,
  StrapiBlocksSchema,
  ContentNewComponentEntrySchema,
} from './schema';
import { extractDocx } from './extract';
import { mapDocumentToArticle, ruleBasedMapping } from './mapper';
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx';

describe('Repeatable contentNew Component Mapping & Validation', () => {
  // 1. One title with multiple paragraphs
  it('maps one title with multiple paragraphs into a single component with multiple paragraph blocks', () => {
    const rawText = `
Title: Choosing the lab
Content: Start with the accreditation scope, because accreditation alone proves little.

An ISO/IEC 17025 certificate covers a defined list of tests.

Accreditation bodies publish each lab's scope, so check it before the first enquiry goes out.
    `.trim();

    const sections = parseSectionsFromText(rawText);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Choosing the lab');

    const payload = buildStrapiPayload({
      contentnew: sections,
    });

    expect(payload.contentNew).toHaveLength(1);
    expect(payload.contentNew![0].title).toBe('Choosing the lab');
    expect(payload.contentNew![0].content).toHaveLength(3);
    expect(payload.contentNew![0].content[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Start with the accreditation scope, because accreditation alone proves little.' }],
    });
    expect(payload.contentNew![0].content[1]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'An ISO/IEC 17025 certificate covers a defined list of tests.' }],
    });
    expect(payload.contentNew![0].content[2]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: "Accreditation bodies publish each lab's scope, so check it before the first enquiry goes out." }],
    });

    const validation = validateStrapiBlocks(payload.contentNew![0].content);
    expect(validation.valid).toBe(true);
  });

  // 2. Multiple title/content sections
  it('maps multiple title/content sections in original order', () => {
    const rawText = `
Title: First Section
Content: First paragraph of first section.

Title: Second Section
Content: Paragraph of second section.

Title: Third Section
Content: Paragraph of third section.
    `.trim();

    const sections = parseSectionsFromText(rawText);
    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.title)).toEqual([
      'First Section',
      'Second Section',
      'Third Section',
    ]);

    const payload = buildStrapiPayload({ contentnew: sections });
    expect(payload.contentNew).toHaveLength(3);
    expect(payload.contentNew![0].title).toBe('First Section');
    expect(payload.contentNew![1].title).toBe('Second Section');
    expect(payload.contentNew![2].title).toBe('Third Section');
  });

  // 3. Five or more sections
  it('processes arbitrary numbers of sections (5+ sections) without truncation or merging', () => {
    const sectionCount = 7;
    const items = Array.from({ length: sectionCount }, (_, i) => ({
      title: `Section Heading ${i + 1}`,
      content: `Content for section ${i + 1} with substantive details.`,
    }));

    const rawText = items
      .map((item) => `Title: ${item.title}\nContent: ${item.content}`)
      .join('\n\n');

    const sections = parseSectionsFromText(rawText);
    expect(sections).toHaveLength(sectionCount);

    const payload = buildStrapiPayload({ contentnew: sections });
    expect(payload.contentNew).toHaveLength(sectionCount);
    for (let i = 0; i < sectionCount; i++) {
      expect(payload.contentNew![i].title).toBe(`Section Heading ${i + 1}`);
      expect(payload.contentNew![i].content[0].type).toBe('paragraph');
    }
  });

  // 4. Nested headings and lists
  it('preserves nested subheadings and lists inside section blocks', () => {
    const sectionBody = `
Introduction to the process.

### Step 1: Verification
Verify all specifications before booking.

- Scope certificate revision
- Schedule availability
- Technical capability
    `.trim();

    const blocks = textToBlocks(sectionBody);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Introduction to the process.' }],
    });
    expect(blocks[1]).toEqual({
      type: 'heading',
      level: 3,
      children: [{ type: 'text', text: 'Step 1: Verification' }],
    });
    expect(blocks[2]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Verify all specifications before booking.' }],
    });
    expect(blocks[3]).toEqual({
      type: 'list',
      format: 'unordered',
      children: [
        { type: 'list-item', children: [{ type: 'text', text: 'Scope certificate revision' }] },
        { type: 'list-item', children: [{ type: 'text', text: 'Schedule availability' }] },
        { type: 'list-item', children: [{ type: 'text', text: 'Technical capability' }] },
      ],
    });

    const validation = validateStrapiBlocks(blocks);
    expect(validation.valid).toBe(true);
  });

  // 5. Documents with no explicit Title: labels (heading-based extraction)
  it('extracts repeatable sections from Word document headings when explicit labels are absent', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Main Article Title', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: 'This is the article summary description.' })] }),
            new Paragraph({ text: 'Introductory blog paragraph that belongs to main body.' }),
            new Paragraph({ text: 'First Section Heading', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ children: [new TextRun({ text: 'Detailed paragraph under section one.' })] }),
            new Paragraph({ text: 'Second Section Heading', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ children: [new TextRun({ text: 'Detailed paragraph under section two.' })] }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const extracted = await extractDocx(buffer, 'headings-document.docx');

    expect(extracted.title).toBe('Main Article Title');
    expect(extracted.parsedFields.contentnew).toBeDefined();
    expect(Array.isArray(extracted.parsedFields.contentnew)).toBe(true);
    expect(extracted.parsedFields.contentnew).toHaveLength(2);
    expect((extracted.parsedFields.contentnew as any)[0].title).toBe('First Section Heading');
    expect((extracted.parsedFields.contentnew as any)[1].title).toBe('Second Section Heading');

    const mapped = ruleBasedMapping(extracted);
    expect(mapped.payload.contentNew).toHaveLength(2);
    expect(mapped.payload.contentNew![0].title).toBe('First Section Heading');
    expect(mapped.payload.contentNew![1].title).toBe('Second Section Heading');
  });

  // 6. Introductory content separate from contentNew
  it('separates introductory blog content into content and repeatable sections into contentNew', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Lab Selection Guide', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: 'Guide summary description.' })] }),
            new Paragraph({ children: [new TextRun({ text: 'Introductory paragraph setting context for the blog.' })] }),
            new Paragraph({ children: [new TextRun({ text: 'Title: Choosing the lab' })] }),
            new Paragraph({ children: [new TextRun({ text: 'Content: Start with the accreditation scope.' })] }),
            new Paragraph({ children: [new TextRun({ text: 'Title: The first request' })] }),
            new Paragraph({ children: [new TextRun({ text: 'Content: The first email or portal submission.' })] }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const extracted = await extractDocx(buffer, 'intro-and-sections.docx');

    expect(extracted.parsedFields.content).toBe('Introductory paragraph setting context for the blog.');
    expect(extracted.parsedFields.contentnew).toHaveLength(2);

    const mapped = ruleBasedMapping(extracted);
    expect(mapped.payload.content).toBe('Introductory paragraph setting context for the blog.');
    expect(mapped.payload.contentNew).toHaveLength(2);
    expect(mapped.payload.contentNew![0].title).toBe('Choosing the lab');
    expect(mapped.payload.contentNew![1].title).toBe('The first request');
  });

  it('keeps the document heading as the article title and extracts labeled body sections with their content', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Booking a Third-Party Test Lab', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: 'Description: Guidance for choosing and booking a test lab.' }),
            new Paragraph({ text: 'Title: Choosing the lab' }),
            new Paragraph({ text: 'Content: Start with the accreditation scope, because accreditation alone proves little.' }),
            new Paragraph({ text: 'An ISO/IEC 17025 certificate covers a defined list of tests.' }),
            new Paragraph({ text: 'Title: The first request' }),
            new Paragraph({ text: 'Content: The first email or portal submission does most of the work.' }),
          ],
        },
      ],
    });

    const extracted = await extractDocx(await Packer.toBuffer(doc), 'labeled-sections.docx');

    expect(extracted.title).toBe('Booking a Third-Party Test Lab');
    expect(extracted.description).toBe('Guidance for choosing and booking a test lab.');
    expect(extracted.parsedFields.contentnew).toEqual([
      {
        title: 'Choosing the lab',
        content: [
          'Start with the accreditation scope, because accreditation alone proves little.',
          'An ISO/IEC 17025 certificate covers a defined list of tests.',
        ].join('\n\n'),
      },
      {
        title: 'The first request',
        content: 'The first email or portal submission does most of the work.',
      },
    ]);

    const mapped = ruleBasedMapping(extracted);
    expect(mapped.payload.Title).toBe('Booking a Third-Party Test Lab');
    expect(mapped.payload.contentNew).toHaveLength(2);
    expect(mapped.payload.contentNew![0].title).toBe('Choosing the lab');
    expect(mapped.payload.contentNew![0].content).toEqual([
      {
        type: 'paragraph',
        children: [{
          type: 'text',
          text: 'Start with the accreditation scope, because accreditation alone proves little.',
        }],
      },
      {
        type: 'paragraph',
        children: [{
          type: 'text',
          text: 'An ISO/IEC 17025 certificate covers a defined list of tests.',
        }],
      },
    ]);
  });

  // 7. Missing titles or empty content validation
  it('validates and rejects component items with missing or empty content blocks', () => {
    const invalidEntry = {
      title: 'Empty Section',
      content: [],
    };

    const parseResult = ContentNewComponentEntrySchema.safeParse(invalidEntry);
    expect(parseResult.success).toBe(false);

    const payloadResult = validateArticlePayload({
      Title: 'Article',
      contentNew: [invalidEntry as any],
    });
    expect(payloadResult.success).toBe(false);
  });

  // 8. Invalid Rich Text Blocks validation
  it('rejects invalid Rich Text Blocks structures with actionable errors', () => {
    // Non-array
    expect(validateStrapiBlocks('Plain string instead of blocks').valid).toBe(false);

    // Invalid block type
    expect(
      validateStrapiBlocks([
        {
          type: 'unsupported_custom_type',
          children: [{ type: 'text', text: 'Hello' }],
        },
      ]).valid
    ).toBe(false);

    // Missing children
    expect(
      validateStrapiBlocks([
        {
          type: 'paragraph',
          children: [],
        },
      ]).valid
    ).toBe(false);

    // Valid blocks pass
    expect(
      validateStrapiBlocks([
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'Valid block text' }],
        },
      ]).valid
    ).toBe(true);
  });

  // 9. Rejects stringified contentNew where array is required
  it('rejects a single-object or string contentNew in Strapi Article payload', () => {
    const singleObject = validateArticlePayload({
      Title: 'Test',
      contentNew: { title: 'Solo', content: [] } as any,
    });
    expect(singleObject.success).toBe(false);

    const stringPayload = validateArticlePayload({
      Title: 'Test',
      contentNew: 'Title: Section One\nContent: Body' as any,
    });
    expect(stringPayload.success).toBe(false);
  });

  // 10. The user uploaded case study text with markdown bold and inline link
  it('successfully unpacks user case study concatenated text into distinct component objects with titles and valid blocks', () => {
    const userUploadedText =
      '**Title: Choosing the lab** **Content: **Start with the accreditation scope, because accreditation alone proves little. An ISO/IEC 17025 certificate covers a defined list of tests, and the standard you need has to appear on that list at the revision you need. Accreditation bodies publish each lab’s scope, so check it before the first enquiry goes out. Once the facility [connected booking, scheduling, execution and reporting](https://testlifecycle.com/casestudy-post/from-customer-requests-to-signed-off-reports-unified-crash-test-workflow) in one workflow, those checks stopped eating into engineering time. **Title: The first request** **Content: **The first email or portal submission does most of the work. These are the fields a lab needs to quote without a follow-up call, shown for a battery module headed for an 800V vehicle pack. **Field** **Example** **Why the lab needs it**';

    const payload = buildStrapiPayload({
      contentnew: userUploadedText,
    });

    expect(payload.contentNew).toBeDefined();
    expect(Array.isArray(payload.contentNew)).toBe(true);
    expect(payload.contentNew).toHaveLength(2);

    // Section 1
    const sec1 = payload.contentNew![0];
    expect(sec1.title).toBe('Choosing the lab');
    expect(sec1.content).toBeDefined();
    expect(sec1.content[0].type).toBe('paragraph');

    // Verify inline link was converted to genuine Strapi link block
    const sec1Children = sec1.content[0].children as any[];
    const linkChild = sec1Children.find((child: any) => child.type === 'link');
    expect(linkChild).toBeDefined();
    expect(linkChild.url).toBe(
      'https://testlifecycle.com/casestudy-post/from-customer-requests-to-signed-off-reports-unified-crash-test-workflow',
    );
    expect(linkChild.children[0].text).toBe(
      'connected booking, scheduling, execution and reporting',
    );

    // Section 2
    const sec2 = payload.contentNew![1];
    expect(sec2.title).toBe('The first request');
    expect(sec2.content[0].type).toBe('paragraph');

    // Both pass full Strapi 5 Blocks validation
    expect(validateStrapiBlocks(sec1.content).valid).toBe(true);
    expect(validateStrapiBlocks(sec2.content).valid).toBe(true);

    // Validates in Strapi Article Payload Schema
    const articleValidation = validateArticlePayload({
      Title: 'Booking a Third-Party Test Lab',
      contentNew: payload.contentNew,
    });
    expect(articleValidation.success).toBe(true);
  });
});
