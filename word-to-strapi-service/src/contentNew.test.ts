import { describe, expect, it } from "vitest";
import {
  extractContentSections,
  sanitizeContentHtml,
  validateContentNewComponents,
} from "./contentNew";
import { extractDocx } from "./extract";
import { getImportCollection, validateImportPayload } from "./collections";
import { mapDocumentToCollection } from "./mapper";
import { StrapiClient } from "./strapiClient";
import { diffPayload } from "./index";
import { vi } from "vitest";

async function createSectionedDocx(): Promise<Buffer> {
  const {
    Document,
    ExternalHyperlink,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
  } = await import("docx");
  const sectionTitles = [
    "Choosing the lab",
    "The first request",
    "The scoping call",
    "The quote and the test plan",
    "Goods inwards",
    "Test week",
    "The report review",
    "The booking is part of the test",
    "Make Every Lab Booking Count",
  ];
  const children = [];
  for (const [index, title] of sectionTitles.entries()) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ text: `Opening paragraph for ${title}.` }));
    if (index === 0) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "See " }),
          new ExternalHyperlink({
            link: "https://example.test/labs",
            children: [new TextRun({ text: "the lab guide" })],
          }),
          new TextRun({ text: " before continuing." }),
        ],
      }));
      children.push(new Table({
        rows: [
          new TableRow({
            children: ["Requirement", "Action"].map((text) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
              }),
            ),
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Accreditation")] }),
              new TableCell({ children: [new Paragraph("Check the current certificate.")] }),
            ],
          }),
        ],
      }));
      children.push(new Paragraph({ text: "Closing paragraph after the table." }));
    }
    if (index === 4) {
      children.push(new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Goods")] }),
              new TableCell({ children: [new Paragraph("Condition")] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Sample crate")] }),
              new TableCell({ children: [new Paragraph("Dry and intact")] }),
            ],
          }),
        ],
      }));
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

describe("contentNew DOCX sections", () => {
  it("extracts all nine sections from actual DOCX headings in document order", async () => {
    const doc = await extractDocx(await createSectionedDocx(), "nine-sections.docx");
    expect(doc.contentSections.map((section) => section.title)).toEqual([
      "Choosing the lab",
      "The first request",
      "The scoping call",
      "The quote and the test plan",
      "Goods inwards",
      "Test week",
      "The report review",
      "The booking is part of the test",
      "Make Every Lab Booking Count",
    ]);
  });

  it("preserves hyperlinks, paragraphs, and table position in a section", async () => {
    const doc = await extractDocx(await createSectionedDocx(), "links-and-tables.docx");
    const first = doc.contentSections[0];
    expect(first.html).toContain('<a href="https://example.test/labs"');
    expect(first.blocks).toContainEqual(expect.objectContaining({
      type: "paragraph",
      children: expect.arrayContaining([
        expect.objectContaining({ type: "link", url: "https://example.test/labs" }),
      ]),
    }));
    const before = first.html.indexOf("Opening paragraph");
    const table = first.html.indexOf("<table>");
    const after = first.html.indexOf("Closing paragraph");
    expect(before).toBeGreaterThanOrEqual(0);
    expect(table).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(table);
    expect(first.html).toContain("<thead>");
    expect(first.html).toContain("<th><p><strong>Requirement</strong></p></th>");
    expect(first.html).toContain("<td><p>Check the current certificate.</p></td>");
  });

  it("maps sections to a validated repeatable Strapi component array", async () => {
    const doc = await extractDocx(await createSectionedDocx(), "mapped-sections.docx");
    const collection = getImportCollection("api::article.article")!;
    const mapping = await mapDocumentToCollection(doc, collection, "", "test-model");
    const components = mapping.payload.contentNew;

    expect(Array.isArray(components)).toBe(true);
    if (!Array.isArray(components)) throw new Error("Expected contentNew component array.");
    expect(components).toHaveLength(9);
    expect(components[0]).toMatchObject({
      title: "Choosing the lab",
      contentHtml: expect.stringContaining("<table>"),
    });
    expect(components[4]).toMatchObject({
      contentHtml: expect.stringContaining("Sample crate"),
    });
    expect(validateImportPayload(collection, mapping.payload).success).toBe(true);
    expect(validateImportPayload(collection, {
      ...mapping.payload,
      contentNew: [{ title: "Invalid", content: "<p>Not Blocks</p>", contentHtml: "<script/>" }],
    }).success).toBe(false);
  });

  it("sends the Strapi 5 data envelope and verifies component values on read-back", async () => {
    const doc = await extractDocx(await createSectionedDocx(), "strapi-payload.docx");
    const collection = getImportCollection("api::article.article")!;
    const mapping = await mapDocumentToCollection(doc, collection, "", "test-model");
    const expected = { contentNew: mapping.payload.contentNew };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body)).data.contentNew).toEqual(expected.contentNew);
        return new Response(JSON.stringify({ data: { documentId: "doc-1", id: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(url).toContain("populate%5BcontentNew%5D=true");
      return new Response(JSON.stringify({ data: { ...expected, documentId: "doc-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const client = new StrapiClient("http://localhost:1337", "test-token");
      const created = await client.createDraftForCollection(collection, expected);
      const saved = await client.getByDocumentIdForCollection(collection, created.documentId);
      expect(created.documentId).toBe("doc-1");
      expect(requests).toHaveLength(2);
      expect(diffPayload(expected, saved)).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("detects inconsistent heading formats without title-specific matching", () => {
    const sections = extractContentSections([
      "<h1>Document title</h1>",
      "<p>Introductory context.</p>",
      "<h2>Styled heading: 1</h2>",
      "<p>Heading body.</p>",
      "<p><strong>Bold heading - 2</strong></p>",
      "<p>Bold heading body.</p>",
      "<p>### Markdown heading (3)</p>",
      "<p>Markdown body.</p>",
    ].join(""));
    expect(sections.map((section) => section.title)).toEqual([
      "Styled heading: 1",
      "Bold heading - 2",
      "Markdown heading (3)",
    ]);
    expect(sections[0].html).toContain("Introductory context.");
    expect(sections[1].html).toContain("Bold heading body.");
    expect(sections[2].html).toContain("Markdown body.");
  });

  it("preserves multiple tables, empty cells, merged cells, nested tables, and cell paragraphs", () => {
    const [section] = extractContentSections(`
      <h2>Rows</h2>
      <p>Before</p>
      <table>
        <thead><tr><th colspan="2">Header</th></tr></thead>
        <tbody>
          <tr><td rowspan="2"><p>First line</p><p>Second line</p></td><td></td></tr>
          <tr><td><table><tr><td>Nested cell</td></tr></table></td></tr>
        </tbody>
      </table>
      <p>Between</p>
      <table><tr><td>Second table</td></tr></table>
      <p>After</p>
    `);
    expect(section.html).toContain('<th colspan="2">Header</th>');
    expect(section.html).toContain('<td rowspan="2"><p>First line</p><p>Second line</p></td>');
    expect(section.html).toContain("<td></td>");
    expect(section.html).toContain("Nested cell");
    expect(section.html).toContain("Second table");
    expect(section.html.indexOf("Before")).toBeLessThan(section.html.indexOf("<table>"));
    expect(section.html.indexOf("Between")).toBeGreaterThan(section.html.indexOf("Nested cell"));
    expect(section.html.indexOf("After")).toBeGreaterThan(section.html.lastIndexOf("<table>"));
    expect(section.warnings).toContain(
      "Tables are stored in contentHtml because Strapi Blocks has no table node.",
    );
  });

  it("escapes untrusted HTML, rejects dangerous URL schemes, and validates saved component shape", () => {
    const html = sanitizeContentHtml(
      '<p onclick="run()">Safe & <script>alert(1)</script><a href="javascript:alert(1)">link</a></p>',
    );
    expect(html).toBe("<p>Safe &amp; link</p>");
    expect(html).not.toMatch(/script|onclick|javascript:/i);
    expect(validateContentNewComponents([{
      title: "Safe",
      content: [{ type: "paragraph", children: [{ type: "text", text: "Safe" }] }],
      contentHtml: html,
    }])).toBe(true);
    expect(validateContentNewComponents([{
      title: "Unsafe",
      content: [],
      contentHtml: '<img src=x onerror="run()">',
    }])).toBe(false);
  });
});
