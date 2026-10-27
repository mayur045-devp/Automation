import { describe, it, expect } from 'vitest';
import { extractDocx, isImagePlaceholder, isTemplateArtifact, normalizeKey, normalizeValue } from '../src/extract.js';

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
            ],
          }),
          new Paragraph({ text: 'Content & Page Components', heading: HeadingLevel.HEADING_2 }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

describe('extractDocx', () => {
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

  // Reproduction of user screenshot document format
  it('correctly parses Blog Content Entry Template tables, extracting title, description, slug and SEO without taking Blog Details as title or polluting content', async () => {
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

    // Content MUST NOT contain section headings or template text
    expect(doc.content).toBeNull();
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
