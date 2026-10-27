/**
 * Generates a sample Article .docx file for testing the import pipeline.
 * Formats as the 2-column Blog Content Entry Template.
 * Run: npx ts-node scripts/generate-sample-docx.ts
 * Output: sample-article.docx in the service root
 */

import * as fs from 'fs';
import * as path from 'path';

async function main() {
  let docxLib: any;
  try {
    docxLib = await import('docx');
  } catch {
    console.error('docx package not found.');
    process.exit(1);
  }

  const {
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    Packer,
  } = docxLib;

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: 'Blog Content Entry Template',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Sample values are provided where useful. Fields marked "Leave empty" are intentionally blank for you to complete.',
              }),
            ],
          }),
          new Paragraph({
            text: 'Blog Details',
            heading: HeadingLevel.HEADING_2,
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('1. Title')] }),
                  new TableCell({
                    children: [new Paragraph('How AI Is Transforming Digital Business')],
                  }),
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
                  new TableCell({
                    children: [new Paragraph('how-ai-is-transforming-digital-business')],
                  }),
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
          new Paragraph({
            text: '5. Default SEO',
            heading: HeadingLevel.HEADING_2,
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('metaTitle')] }),
                  new TableCell({
                    children: [
                      new Paragraph('How AI Is Transforming Digital Business | 12th Wonder'),
                    ],
                  }),
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
                  new TableCell({ children: [new Paragraph('AI, Digital Business, Automation')] }),
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
          new Paragraph({
            text: 'Content & Page Components',
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: 'Key Drivers of Digital Transformation',
            heading: HeadingLevel.HEADING_3,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Artificial intelligence is no longer speculative — it is actively reshaping customer service through intelligent conversational agents, forecasting supply-chain disruptions with predictive analytics, and enabling hyper-personalized user experiences at scale.',
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = path.join(process.cwd(), 'sample-article.docx');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Sample .docx created: ${outPath}`);
}

main().catch(console.error);
