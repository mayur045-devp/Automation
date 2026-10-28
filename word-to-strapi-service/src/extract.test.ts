import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { extractDocx, isImagePlaceholder, isTemplateArtifact, normalizeKey, normalizeValue } from '../src/extract.js';
import { ruleBasedMapping } from '../src/mapper.js';

async function getMinimalDocxBuffer(text: string): Promise<Buffer> {
  const { Document, Paragraph, TextRun, Packer } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function getFieldTableDocxBuffer(rows: Array<[string, string]>): Promise<Buffer> {
  const { Document, Paragraph, Table, TableRow, TableCell, Packer } = await import('docx');
  const doc = new Document({
    sections: [{
      children: [
        new Table({
          rows: rows.map(([label, value]) => new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(label)] }),
              new TableCell({ children: [new Paragraph(value)] }),
            ],
          })),
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function getArticleDocxBuffer(): Promise<Buffer> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Test Article Title', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: 'This is the article description paragraph.' })] }),
          new Paragraph({ text: 'Section Heading', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: 'Body content goes here with details.' })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function getTitleAndDescriptionOnlyDocxBuffer(): Promise<Buffer> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Title Only Article', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: 'A brief summary of this article.' })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function getComplexMetadataDocxBuffer(): Promise<Buffer> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Modern Web Architecture', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: 'An overview of decoupled CMS and modern frontend stacks.' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Author: Dr. Jane Smith' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Date: 2026-10-26' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Category: Architecture' })] }),
          new Paragraph({ children: [new TextRun({ text: 'SEO Title: Modern Web Architecture 2026' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Meta Description: Explore headless CMS and Strapi 5' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Keywords: Strapi, Architecture, Svelte' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Button Title: Explore Documentation' })] }),
          new Paragraph({ children: [new TextRun({ text: '[Optional cover photo: Cloud diagram]' })] }),
          new Paragraph({ text: 'Introduction to Decoupled CMS', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: 'Decoupled content management systems offer substantial flexibility.' })] }),
          new Paragraph({ text: 'Frequently Asked Questions', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: 'Q: What is Strapi? A: An open-source headless CMS.' })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function getBlogContentEntryTemplateDocxBuffer(): Promise<Buffer> {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, Packer } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Blog Content Entry Template', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Sample values are provided where useful. Fields marked "Leave empty" are intentionally blank for you to complete.',
              }),
            ],
          }),
          new Paragraph({ text: 'Blog Details', heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('1. Title')] }),
                  new TableCell({ children: [new Paragraph('How AI Is Transforming Digital Business')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('2. Description')] }),
                  new TableCell({
                    children: [
                      new Paragraph(
                        'Explore how businesses can use artificial intelligence to improve operations, personalize customer experiences, and make more informed decisions.'
                      ),
                    ],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('3. Slug')] }),
                  new TableCell({ children: [new Paragraph('how-ai-is-transforming-digital-business')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('4. Cover [Image]')] }),
                  new TableCell({
                    children: [new Paragraph('Leave empty — add/select the cover image in Strapi.')],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: '5. Default SEO', heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('metaTitle')] }),
                  new TableCell({ children: [new Paragraph('How AI Is Transforming Digital Business | 12th Wonder')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('metaDescription')] }),
                  new TableCell({
                    children: [
                      new Paragraph(
                        'Learn how AI can help businesses streamline operations, personalize customer experiences, and support smarter decisions.'
                      ),
                    ],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('keywords')] }),
                  new TableCell({ children: [new Paragraph('')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('metaRobots')] }),
                  new TableCell({ children: [new Paragraph('index, follow')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('metaViewPort')] }),
                  new TableCell({ children: [new Paragraph('width=device-width, initial-scale=1')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('structuredData')] }),
                  new TableCell({ children: [new Paragraph('No provided value.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('canonicalURL')] }),
                  new TableCell({ children: [new Paragraph('No provided value.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('shareImage')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — select an image if required.')] }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: 'Content & Page Components', heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('content')] }),
                  new TableCell({
                    children: [new Paragraph('Artificial intelligence is reshaping digital business by helping teams improve operations, personalize customer experiences, and make better decisions.')],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('date')] }),
                  new TableCell({ children: [new Paragraph('2026-10-26')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('authordata')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — add the correct author entry/relation.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('categoryname')] }),
                  new TableCell({ children: [new Paragraph('Digital Transformation')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('contentnew')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — populate if this is a separate rich-text field.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('button')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — add button URL/action if applicable.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('buttontitle')] }),
                  new TableCell({ children: [new Paragraph('Explore Our Services')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('buttonsubtitle')] }),
                  new TableCell({ children: [new Paragraph('Discover practical digital solutions for your business.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('blogcategories')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — select the appropriate category relation(s).')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('time')] }),
                  new TableCell({ children: [new Paragraph('5 min read')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('faqsection')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — add FAQ items if needed.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('formsection')] }),
                  new TableCell({ children: [new Paragraph('Leave empty — connect/select the correct form section if applicable.')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('popularityname')] }),
                  new TableCell({ children: [new Paragraph('Trending')] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

describe('extractDocx', () => {
  it('does not mistake hyphenated or em-dash body prose for unknown field labels', async () => {
    const buffer = await readFile(new URL('../sample-article.docx', import.meta.url));
    const doc = await extractDocx(buffer, 'sample-article.docx');

    expect(doc.unmappedFields).toHaveLength(0);
    expect(doc.content).toContain('net-zero targets');
    expect(doc.content).toContain('promise — it is happening now');
  });

  it('extracts title from H1 heading', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'test.docx');
    expect(doc.title).toBe('Test Article Title');
  });

  it('extracts description from first paragraph', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'test.docx');
    expect(doc.description).toContain('description paragraph');
  });

  it('populates headings array correctly', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'test.docx');
    expect(doc.headings.some((h) => h.level === 1 && h.text === 'Test Article Title')).toBe(true);
    expect(doc.headings.some((h) => h.level === 2 && h.text === 'Section Heading')).toBe(true);
  });

  it('returns empty images array when no images in docx', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'test.docx');
    expect(doc.images).toHaveLength(0);
    expect(doc.metadata.hasImages).toBe(false);
  });

  it('returns correct filename in metadata', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'my-test-file.docx');
    expect(doc.metadata.filename).toBe('my-test-file.docx');
  });

  it('counts words', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'test.docx');
    expect(doc.metadata.wordCount).toBeGreaterThan(0);
  });

  it('handles empty/minimal docx gracefully', async () => {
    const buffer = await getMinimalDocxBuffer('');
    const doc = await extractDocx(buffer, 'empty.docx');
    expect(doc).toBeDefined();
    expect(doc.images).toHaveLength(0);
  });

  it('leaves content as null when document has only title and description', async () => {
    const buffer = await getTitleAndDescriptionOnlyDocxBuffer();
    const doc = await extractDocx(buffer, 'title-desc.docx');
    expect(doc.title).toBe('Title Only Article');
    expect(doc.description).toBe('A brief summary of this article.');
    expect(doc.content).toBeNull();
  });

  it('maps populated body ONLY to content without title and description', async () => {
    const buffer = await getArticleDocxBuffer();
    const doc = await extractDocx(buffer, 'with-body.docx');
    expect(doc.content).not.toBeNull();
    expect(doc.content).toContain('Section Heading');
    expect(doc.content).toContain('Body content goes here with details.');
    // Title and Description MUST NOT be in content
    expect(doc.content).not.toContain('Test Article Title');
    expect(doc.content).not.toContain('This is the article description paragraph.');
  });

  it('extracts metadata fields independently and keeps them out of content', async () => {
    const buffer = await getComplexMetadataDocxBuffer();
    const doc = await extractDocx(buffer, 'complex.docx');

    expect(doc.title).toBe('Modern Web Architecture');
    expect(doc.description).toBe('An overview of decoupled CMS and modern frontend stacks.');

    // Metadata extracted into parsedFields
    expect(doc.parsedFields.authordata).toBe('Dr. Jane Smith');
    expect(doc.parsedFields.date).toBe('2026-10-26');
    expect(doc.parsedFields.categoryname).toBe('Architecture');
    expect(doc.parsedFields.buttontitle).toBe('Explore Documentation');
    expect(doc.parsedFields.defaultSeo?.metaTitle).toBe('Modern Web Architecture 2026');
    expect(doc.parsedFields.defaultSeo?.metaDescription).toBe('Explore headless CMS and Strapi 5');
    expect(doc.parsedFields.defaultSeo?.keywords).toEqual(['Strapi', 'Architecture', 'Svelte']);
    expect(doc.parsedFields.faqsection).toContain('What is Strapi?');

    // Content contains ONLY the main body!
    expect(doc.content).toContain('Introduction to Decoupled CMS');
    expect(doc.content).toContain('Decoupled content management systems offer substantial flexibility.');

    // Unrelated fields MUST NOT be in content
    expect(doc.content).not.toContain('Modern Web Architecture 2026');
    expect(doc.content).not.toContain('Dr. Jane Smith');
    expect(doc.content).not.toContain('2026-10-26');
    expect(doc.content).not.toContain('Architecture');
    expect(doc.content).not.toContain('Explore Documentation');
    expect(doc.content).not.toContain('What is Strapi?');
    expect(doc.content).not.toContain('[Optional cover photo');
  });

  it('recognizes aliases and fields in arbitrary order while retaining unknown labels', async () => {
    const buffer = await getFieldTableDocxBuffer([
      ['Category Name', 'Technology'],
      ['META TITLE', 'AI in Practice'],
      ['Article Title', 'A Real Article'],
      ['Published Date', '2026-10-26'],
      ['SEO Keywords', 'AI, business'],
      ['New Editor Field', 'retain this value'],
    ]);
    const doc = await extractDocx(buffer, 'aliases.docx');

    expect(doc.parsedFields.title).toBe('A Real Article');
    expect(doc.parsedFields.categoryname).toBe('Technology');
    expect(doc.parsedFields.date).toBe('2026-10-26');
    expect(doc.parsedFields.defaultSeo?.metaTitle).toBe('AI in Practice');
    expect(doc.parsedFields.defaultSeo?.keywords).toEqual(['AI', 'business']);
    expect(doc.unmappedFields).toContainEqual({ label: 'New Editor Field', value: 'retain this value' });
  });

  it('associates heading labels with their following paragraph values', async () => {
    const { Document, Paragraph, HeadingLevel, Packer } = await import('docx');
    const buffer = await Packer.toBuffer(new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Date', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: '2026-10-26' }),
          new Paragraph({ text: 'Title', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: 'A title below its label' }),
          new Paragraph({ text: 'SEO Title', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: 'SEO value below its label' }),
        ],
      }],
    }));
    const doc = await extractDocx(buffer, 'heading-labels.docx');

    expect(doc.parsedFields.date).toBe('2026-10-26');
    expect(doc.parsedFields.title).toBe('A title below its label');
    expect(doc.parsedFields.defaultSeo?.metaTitle).toBe('SEO value below its label');
    expect(doc.content).toBeNull();
  });

  it('flags conflicting duplicate labels and invalid dates rather than choosing silently', async () => {
    const buffer = await getFieldTableDocxBuffer([
      ['Title', 'First title'],
      ['Title', 'Different title'],
      ['Date', '2026-02-31'],
      ['Unknown Setting', 'Keep me visible'],
    ]);
    const doc = await extractDocx(buffer, 'duplicate-fields.docx');

    expect(doc.parsedFields.title).toBe('First title');
    expect(doc.fieldStates.title.status).toBe('requires_review');
    expect(doc.fieldStates.title.reason).toContain('Conflicting duplicate');
    expect(doc.fieldStates.date.status).toBe('invalid');
    expect(doc.unmappedFields).toContainEqual({ label: 'Unknown Setting', value: 'Keep me visible' });
  });

  it('reports absent fields as missing, not explicitly empty', async () => {
    const doc = await extractDocx(await getMinimalDocxBuffer(''), 'empty.docx');
    expect(doc.fieldStates.date.status).toBe('missing');
    expect(doc.fieldStates['defaultSeo.keywords'].status).toBe('missing');
    expect(doc.fieldStates.cover.status).toBe('missing');
  });

  it('does not accept an embedded-image marker unless the referenced image was extracted', async () => {
    const doc = await extractDocx(
      await getFieldTableDocxBuffer([['Cover [Image]', '[IMAGE_0]']]),
      'missing-image.docx'
    );
    expect(doc.fieldStates.cover.status).toBe('invalid');
    expect(doc.fieldStates.cover.reason).toContain('was not extracted');
  });

  it('extracts multiple embedded image binaries and preserves their document locations', async () => {
    const { Document, Paragraph, HeadingLevel, ImageRun, Packer } = await import('docx');
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64',
    );
    const makeImage = (description: string) => new ImageRun({
      type: 'png',
      data: imageBytes,
      transformation: { width: 1, height: 1 },
      altText: { name: description, description, title: description },
    });
    const buffer = await Packer.toBuffer(new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Cover image', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [makeImage('Cover photo')] }),
          new Paragraph({ text: 'Share image', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [makeImage('Social preview')] }),
        ],
      }],
    }));

    const doc = await extractDocx(buffer, 'images.docx');

    expect(doc.images).toHaveLength(2);
    expect(doc.images[0].buffer).toEqual(imageBytes);
    expect(doc.images[1].buffer).toEqual(imageBytes);
    expect(doc.images[0].altText).toBe('Cover photo');
    expect(doc.images[0].location).toContain('Cover image');
    expect(doc.images[1].location).toContain('Share image');
    expect(doc.rawText).toContain('[IMAGE_0]');
    expect(doc.rawText).toContain('[IMAGE_1]');
    expect(doc.fieldStates.cover.status).toBe('extracted');
    expect(doc.fieldStates.cover.imageIndex).toBe(0);
  });

  // Reproduction of user screenshot document format
  it('extracts every supplied template field and preserves empty/unresolved distinctions', async () => {
    const buffer = await getBlogContentEntryTemplateDocxBuffer();
    const doc = await extractDocx(buffer, 'blog_content_entry_template.docx');

    // Title MUST be the value from "1. Title", NOT "Blog Details"
    expect(doc.title).toBe('How AI Is Transforming Digital Business');
    expect(doc.title).not.toBe('Blog Details');
    expect(doc.title).not.toBe('Blog Content Entry Template');

    // Description MUST be the value from "2. Description", NOT template instructions
    expect(doc.description).toBe(
      'Explore how businesses can use artificial intelligence to improve operations, personalize customer experiences, and make more informed decisions.'
    );
    expect(doc.description).not.toContain('Sample values are provided');

    // Slug MUST be the value from "3. Slug", NOT "blog-details"
    expect(doc.slug).toBe('how-ai-is-transforming-digital-business');
    expect(doc.slug).not.toBe('blog-details');

    // "Leave empty" cover image maps to null
    expect(doc.parsedFields.cover).toBeNull();

    // Default SEO fields mapped correctly
    expect(doc.parsedFields.defaultSeo?.metaTitle).toBe('How AI Is Transforming Digital Business | 12th Wonder');
    expect(doc.parsedFields.defaultSeo?.metaDescription).toBe(
      'Learn how AI can help businesses streamline operations, personalize customer experiences, and support smarter decisions.'
    );
    expect(doc.parsedFields.defaultSeo?.metaRobots).toBe('index, follow');
    expect(doc.parsedFields.defaultSeo?.keywords).toEqual([]);
    expect(doc.parsedFields.defaultSeo?.metaViewPort).toBe('width=device-width, initial-scale=1');
    expect(doc.parsedFields.defaultSeo?.structuredData).toBeNull();
    expect(doc.parsedFields.defaultSeo?.canonicalURL).toBeNull();
    expect(doc.parsedFields.defaultSeo?.shareImage).toBeNull();
    expect(doc.parsedFields.content).toBe(
      'Artificial intelligence is reshaping digital business by helping teams improve operations, personalize customer experiences, and make better decisions.'
    );
    expect(doc.parsedFields.date).toBe('2026-10-26');
    expect(doc.parsedFields.categoryname).toBe('Digital Transformation');
    expect(doc.parsedFields.buttontitle).toBe('Explore Our Services');
    expect(doc.parsedFields.buttonsubtitle).toBe('Discover practical digital solutions for your business.');
    expect(doc.parsedFields.time).toBe('5 min read');
    expect(doc.parsedFields.popularityname).toBe('Trending');

    expect(doc.fieldStates['defaultSeo.keywords'].status).toBe('explicitly_empty');
    expect(doc.fieldStates['defaultSeo.structuredData'].status).toBe('explicitly_empty');
    expect(doc.fieldStates['defaultSeo.canonicalURL'].status).toBe('explicitly_empty');
    expect(doc.fieldStates.cover.status).toBe('unresolved');
    expect(doc.fieldStates.authordata.status).toBe('unresolved');
    expect(doc.fieldStates.contentnew.status).toBe('unresolved');
    expect(doc.fieldStates.button.status).toBe('unresolved');
    expect(doc.fieldStates.blogcategories.status).toBe('unresolved');
    expect(doc.fieldStates.faqsection.status).toBe('unresolved');
    expect(doc.fieldStates.formsection.status).toBe('unresolved');

    expect(doc.content).toBe(doc.parsedFields.content);

    const mapped = ruleBasedMapping(doc);
    expect(mapped.payload).toEqual({
      Title: 'How AI Is Transforming Digital Business',
      description: 'Explore how businesses can use artificial intelligence to improve operations, personalize customer experiences, and make more informed decisions.',
      slug: 'how-ai-is-transforming-digital-business',
      content: 'Artificial intelligence is reshaping digital business by helping teams improve operations, personalize customer experiences, and make better decisions.',
      date: '2026-10-26',
      categoryName: 'Digital Transformation',
      buttontitle: 'Explore Our Services',
      buttonsubtitle: 'Discover practical digital solutions for your business.',
      time: '5 min read',
      seo: {
        metaTitle: 'How AI Is Transforming Digital Business | 12th Wonder',
        metaDescription: 'Learn how AI can help businesses streamline operations, personalize customer experiences, and support smarter decisions.',
        metaRobots: 'index, follow',
        metaViewport: 'width=device-width, initial-scale=1',
      },
    });
    expect(mapped.fields.popularityname).toBe('Trending');
    expect(mapped.fieldStates.popularityname.status).toBe('unresolved');
    expect(mapped.fieldStates.title.uploadStatus).toBe('ready');
    expect(mapped.fieldStates.cover.uploadStatus).toBe('manual');
    expect(mapped.fieldStates['defaultSeo.keywords'].uploadStatus).toBe('not_ready');
    expect(mapped.fieldStates.popularityname.uploadStatus).toBe('unsupported');
    expect(mapped.payload).not.toHaveProperty('popularityname');
    expect(mapped.payload).not.toHaveProperty('coverImage');
  });
});

describe('Helper functions', () => {
  it('identifies image placeholder strings', () => {
    expect(isImagePlaceholder('[Optional cover photo: AI technology]')).toBe(true);
    expect(isImagePlaceholder('[Cover photo: My image]')).toBe(true);
    expect(isImagePlaceholder('Leave empty — add/select the cover image in Strapi.')).toBe(true);
    expect(isImagePlaceholder('This is a normal paragraph.')).toBe(false);
  });

  it('identifies template artifacts', () => {
    expect(isTemplateArtifact('Blog Content Entry Template')).toBe(true);
    expect(isTemplateArtifact('Blog Details')).toBe(true);
    expect(isTemplateArtifact('5. Default SEO')).toBe(true);
    expect(isTemplateArtifact('Content & Page Components')).toBe(true);
    expect(isTemplateArtifact('Sample values are provided where useful.')).toBe(true);
    expect(isTemplateArtifact('How AI Is Transforming Digital Business')).toBe(false);
  });

  it('normalizes keys correctly', () => {
    expect(normalizeKey('1. Title')).toBe('title');
    expect(normalizeKey('2. Description')).toBe('description');
    expect(normalizeKey('3. Slug')).toBe('slug');
    expect(normalizeKey('4. Cover [Image]')).toBe('cover');
    expect(normalizeKey('metaTitle')).toBe('metatitle');
  });

  it('normalizes values correctly', () => {
    expect(normalizeValue('Leave empty — add/select the cover image in Strapi.')).toBeNull();
    expect(normalizeValue('Leave empty')).toBeNull();
    expect(normalizeValue('')).toBeNull();
    expect(normalizeValue('How AI Is Transforming Digital Business')).toBe('How AI Is Transforming Digital Business');
  });
});
