import mammoth from "mammoth";
import { parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import path from "path";
import {
  extractContentSections,
  validateContentSections,
  type ContentSection,
} from "./contentNew";
import {
  DOCUMENT_FIELD_KEYS,
  DOCUMENT_FIELD_MAPPINGS,
  slugify,
  parseSectionsFromText,
} from "./schema";
import type {
  DocumentFields,
  DocumentFieldKey,
  FieldState,
  FieldStates,
} from "./schema";

export interface ExtractedImage {
  index: number;
  altText: string;
  caption: string;
  location: string;
  relationshipId?: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface ExtractedDocument {
  title: string | null;
  description: string | null;
  slug: string | null;
  content: string | null; // ONLY main article body (null if no separate main body exists)
  headings: Array<{ level: number; text: string }>;
  paragraphs: string[];
  lists: string[][];
  contentSections: ContentSection[];
  contentWarnings: string[];
  images: ExtractedImage[];
  rawText: string;
  metadata: {
    wordCount: number;
    hasImages: boolean;
    extractedAt: string;
    filename: string;
  };
  parsedFields: Partial<DocumentFields>;
  fieldStates: FieldStates;
  unmappedFields: Array<{ label: string; value: string }>;
  ambiguousHeadings?: string[];
}

/**
 * Check if text represents an image placeholder or empty instruction rather than a real image asset.
 * e.g. [Optional cover photo: AI technology] or "Leave empty — add/select the cover image in Strapi."
 */
export function isImagePlaceholder(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith("[optional cover photo") ||
    lower.startsWith("[cover photo") ||
    lower.startsWith("[optional cover image") ||
    lower.startsWith("[cover image") ||
    lower.startsWith("[optional image") ||
    lower.startsWith("[image:") ||
    lower.startsWith("[image_") ||
    lower.startsWith("leave empty")
  );
}

/**
 * Identify template structural artifacts, headers, or instructions that should NEVER
 * be treated as title, description, or article body content.
 */
export function isTemplateArtifact(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower === "blog content entry template" ||
    lower.includes("content entry template") ||
    lower.includes('fields marked "leave empty"') ||
    lower.includes("sample values are provided") ||
    lower === "blog details" ||
    lower === "default seo" ||
    lower === "5. default seo" ||
    lower.startsWith("5. default seo") ||
    lower === "content & page components" ||
    lower.startsWith("content & page components") ||
    lower === "1. title" ||
    lower === "2. description" ||
    lower === "3. slug" ||
    lower === "4. cover [image]"
  );
}

/**
 * Normalize a table cell key or label name.
 * e.g. "1. Title" -> "title", "4. Cover [Image]" -> "cover", "metaTitle" -> "metatitle"
 */
export function normalizeKey(key: string): string {
  return key
    .replace(/^\d+[\.\)]\s*/, "") // remove leading "1. " or "1) "
    .replace(/\[.*?\]/g, "") // remove "[Image]"
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // remove spaces, colons, hyphens
}

/**
 * Normalize a field value. Detects "Leave empty" instructions and returns null.
 */
export function normalizeValue(val: string): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("leave empty") ||
    lower === "[leave empty]" ||
    lower === "empty" ||
    lower === "empty." ||
    lower === "no provided value" ||
    lower === "no provided value." ||
    lower === "not provided" ||
    lower === "n/a" ||
    lower === "none" ||
    lower === "(none)"
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Try to parse a labeled line like "Author: John Doe" or "SEO Title - My Title".
 */
export function parseLabeledField(
  text: string,
): { label: string; value: string } | null {
  const clean = text.replace(/^\*\*|\*\*$/g, "").trim();
  const match = clean.match(/^([A-Za-z0-9\s\.\[\]]+?)\s*([:—–-])\s*(.*)$/);
  if (!match) return null;
  const label = normalizeKey(match[1]);
  if (match[2] !== ":" && !FIELD_ALIASES[label]) return null;
  const value = match[3].replace(/^\*\*|\*\*$/g, "").trim();
  return { label, value };
}

const FIELD_ALIASES: Record<string, DocumentFieldKey> = Object.fromEntries(
  DOCUMENT_FIELD_MAPPINGS.flatMap(({ label, aliases = [], internalField }) =>
    [label, ...aliases].map((alias) => [normalizeKey(alias), internalField]),
  ),
);

function initialFieldStates(): FieldStates {
  return Object.fromEntries(
    DOCUMENT_FIELD_KEYS.map((key) => [key, { status: "missing" as const }]),
  );
}

function classifyFieldValue(
  key: DocumentFieldKey,
  rawValue: string,
): { state: FieldState; value: string | null } {
  const value = rawValue.trim();
  const imageMatch = value.match(/\[IMAGE_(\d+)\]/i);
  if (key === "cover" && imageMatch) {
    return {
      state: {
        status: "extracted",
        reason: "Image is explicitly placed in the Cover field.",
        rawValue: value,
        imageIndex: Number(imageMatch[1]),
      },
      value: null,
    };
  }

  if (!value) {
    return { state: { status: "explicitly_empty", rawValue }, value: null };
  }

  const lower = value.toLowerCase();
  if (
    /^(empty|no provided value|not provided|n\/a|none|\(none\)|\[leave empty\])\.?$/.test(
      lower,
    )
  ) {
    return { state: { status: "explicitly_empty", rawValue }, value: null };
  }
  if (
    lower.startsWith("leave empty") ||
    lower.startsWith("select ") ||
    lower.startsWith("add ") ||
    lower.startsWith("connect ") ||
    lower.startsWith("choose ") ||
    lower.startsWith("[optional") ||
    lower.startsWith("[cover") ||
    lower.startsWith("[image")
  ) {
    return {
      state: {
        status: "unresolved",
        reason: "Template instruction or placeholder, not a field value.",
        rawValue,
      },
      value: null,
    };
  }

  if (key === "cover" || key === "defaultSeo.shareImage") {
    return {
      state: {
        status: "unresolved",
        reason:
          "Media fields require an explicitly referenced embedded image or manual selection.",
        rawValue,
      },
      value: null,
    };
  }
  if (key === "blogcategories") {
    return {
      state: {
        status: "unresolved",
        reason:
          "Category text cannot safely resolve the current Article relation.",
        rawValue,
      },
      value,
    };
  }
  if (key === "contentnew") {
    return {
      state: {
        status: "extracted",
        reason: "Mapped to structured Blocks content in Strapi.",
        rawValue,
      },
      value,
    };
  }
  if (
    key === "faqsection" ||
    key === "formsection" ||
    key === "popularityname"
  ) {
    return {
      state: {
        status: "unresolved",
        reason:
          "No matching attribute exists in the current Strapi Article schema.",
        rawValue,
      },
      value,
    };
  }
  if (key === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      state: {
        status: "invalid",
        reason: "Expected a date in YYYY-MM-DD format.",
        rawValue,
      },
      value,
    };
  }
  if (key === "date") {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return {
        state: {
          status: "invalid",
          reason: "Date is not a valid calendar date.",
          rawValue,
        },
        value,
      };
    }
  }
  if (key === "slug" && !slugify(value)) {
    return {
      state: {
        status: "invalid",
        reason: "Slug contains no usable URL characters.",
        rawValue,
      },
      value,
    };
  }
  if (
    key === "button" &&
    !(
      /^https?:\/\/\S+$/i.test(value) ||
      /^\/[^/\s][^\s]*$/.test(value) ||
      /^#[^\s]+$/.test(value)
    )
  ) {
    return {
      state: {
        status: "requires_review",
        reason: "Button value is not a verified URL/path for button.link.",
        rawValue,
      },
      value,
    };
  }

  return { state: { status: "extracted", rawValue }, value };
}

function assignField(
  fields: Partial<DocumentFields>,
  states: FieldStates,
  label: string,
  rawValue: string,
): boolean {
  const key = FIELD_ALIASES[normalizeKey(label)];
  if (!key) return false;

  const classified = classifyFieldValue(key, rawValue);
  const existing = states[key];
  if (
    existing &&
    existing.status !== "missing" &&
    existing.rawValue !== undefined &&
    existing.rawValue !== rawValue.trim()
  ) {
    states[key] = {
      status: "requires_review",
      reason: `Conflicting duplicate values for "${label}".`,
      rawValue: `${existing.rawValue}\n${rawValue.trim()}`,
    };
    return true;
  }
  states[key] = classified.state;

  const value = classified.value;
  if (key.startsWith("defaultSeo.")) {
    const seoKey = key.slice("defaultSeo.".length) as keyof NonNullable<
      DocumentFields["defaultSeo"]
    >;
    const seo = fields.defaultSeo ?? {};
    if (seoKey === "keywords") {
      seo.keywords = value
        ? value
          .split(/[,;]\s*/)
          .map((part) => part.trim())
          .filter(Boolean)
        : [];
    } else {
      seo[seoKey] = value;
    }
    fields.defaultSeo = seo;
    return true;
  }

  switch (key) {
    case "title":
      fields.title = value;
      break;
    case "description":
      fields.description = value;
      break;
    case "slug":
      fields.slug = value;
      break;
    case "cover":
      fields.cover = value;
      break;
    case "content":
      fields.content = value;
      break;
    case "date":
      fields.date = value;
      break;
    case "authordata":
      fields.authordata = value;
      break;
    case "categoryname":
      fields.categoryname = value;
      break;
    case "contentnew":
      fields.contentnew = value;
      break;
    case "button":
      fields.button = value;
      break;
    case "buttontitle":
      fields.buttontitle = value;
      break;
    case "buttonsubtitle":
      fields.buttonsubtitle = value;
      break;
    case "blogcategories":
      fields.blogcategories =
        value && value.includes(",")
          ? value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
          : value;
      break;
    case "time":
      fields.time = value;
      break;
    case "faqsection":
      fields.faqsection = value;
      break;
    case "formsection":
      fields.formsection = value;
      break;
    case "popularityname":
      fields.popularityname = value;
      break;
  }
  return true;
}

/**
 * Parse 2-column tables from Mammoth HTML into key-value pairs.
 */
function parseTables(html: string): Array<{ key: string; value: string; tableIndex: number }> {
  const document = parseDocument(html, { decodeEntities: true });
  const tables = document.children.filter(
    (node): node is Element => isElement(node) && node.name === "table",
  );
  const pairs: Array<{ key: string; value: string; tableIndex: number }> = [];

  tables.forEach((table, tableIndex) => {
    for (const row of tableRows(table)) {
      const cells = row.children
        .filter((child): child is Element =>
          isElement(child) && (child.name === "td" || child.name === "th"),
        )
        .map((cell) => readableNodeText(cell).trim());
      if (cells.length < 2 || !cells[0]) continue;
      pairs.push({
        key: cells[0],
        value: cells.slice(1).join(" ").trim(),
        tableIndex,
      });
    }
  });
  return pairs;
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (element: Element): void => {
    for (const child of element.children) {
      if (!isElement(child) || child.name === "table") continue;
      if (child.name === "tr") rows.push(child);
      else visit(child);
    }
  };
  visit(table);
  return rows;
}

function readableNodeText(node: AnyNode): string {
  if (node.type === "text") return node.data;
  if (!isElement(node)) return "";
  if (node.name === "img") {
    const token = node.attribs.src?.match(/^\[IMAGE_\d+\]$/i)?.[0];
    if (token) return token;
    return `[Image: ${node.attribs.alt?.trim() || "embedded image"}]`;
  }
  if (node.name === "br") return "\n";

  const content = node.children.map(readableNodeText).join("");
  if (node.name === "a") {
    const url = node.attribs.href?.trim();
    return url && /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url)
      ? `[${content}](${url})`
      : content;
  }
  if (node.name === "strong" || node.name === "b") return `**${content}**`;
  if (node.name === "em" || node.name === "i") return `*${content}*`;
  if (node.name === "s") return `~~${content}~~`;
  if (node.name === "u") return `<u>${content}</u>`;
  return content;
}

function readableTableText(table: Element): string {
  return tableRows(table).map((row) => {
    const cells = row.children
      .filter((child): child is Element =>
        isElement(child) && (child.name === "td" || child.name === "th"),
      )
      .map((cell) => cell.children.map(readableNodeText).join(" ").trim());
    return `| ${cells.join(" | ")} |`;
  }).join("\n");
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

/**
 * Only interpret Title/Content rows as repeatable contentNew items when the
 * table is explicitly under a Contentnew heading. Other tables in the article
 * template also contain a Title row (the article title), and must stay metadata.
 */
function parseContentNewTable(html: string): {
  pairs: Array<{ key: string; value: string }>;
  tableHtml: string;
} | null {
  const tableRegex = /<table[^>]*>.*?<\/table>/gis;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(html)) !== null) {
    const before = stripHtml(html.slice(0, match.index)).trim();
    const precedingLabel = before.split(/\s+/).slice(-5).join(" ");
    if (!/(?:\bcontent\s*new\b|\bcontentnew\b)\s*$/i.test(precedingLabel)) continue;
    const tableHtml = match[0];
    const pairs = parseTables(tableHtml);
    if (pairs.some(({ key }) => ["title", "sectiontitle"].includes(normalizeKey(key))) &&
        pairs.some(({ key }) => normalizeKey(key) === "content")) {
      return { pairs, tableHtml };
    }
  }
  return null;
}

export interface ExtractedSectionItem {
  title: string;
  content: string;
}

export function extractTableSections(
  pairs: Array<{ key: string; value: string }>,
): ExtractedSectionItem[] {
  const sections: ExtractedSectionItem[] = [];
  let currentTitle: string | null = null;
  let currentContent: string[] = [];

  const flush = () => {
    if (currentTitle && currentContent.length > 0) {
      sections.push({
        title: currentTitle,
        content: currentContent.join("\n\n"),
      });
      currentTitle = null;
      currentContent = [];
    }
  };

  for (const { key, value } of pairs) {
    const norm = normalizeKey(key);
    if (norm === "title" || norm === "sectiontitle") {
      flush();
      currentTitle = value.trim();
    } else if (norm === "content" && currentTitle) {
      currentContent.push(value.trim());
    } else if (currentTitle && value.trim()) {
      currentContent.push(`${key}: ${value.trim()}`);
    }
  }

  flush();
  return sections;
}

type DocElement =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function detectExplicitSections(
  elements: DocElement[],
  usedIndices: Set<number>,
  titleElemIndex: number = -1,
  docTitle?: string | null,
  docDescription?: string | null,
): {
  introductoryContent: string | null;
  sections: ExtractedSectionItem[];
  usedElementIndices: Set<number>;
} | null {
  const titleIndices: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    if (usedIndices.has(i)) continue;
    const elem = elements[i];
    if (elem.type === "paragraph") {
      const match = elem.text.match(/(?:^|\r?\n|\*\*)\s*(?:Title|Section Title)\s*[:—–-]\s*/i);
      if (match) {
        titleIndices.push(i);
      }
    }
  }

  if (titleIndices.length === 0) return null;

  // Single paragraph with inline sections (e.g. "**Title: Choosing the lab** **Content: **... **Title: The first request**...")
  if (titleIndices.length === 1) {
    const singleElem = elements[titleIndices[0]];
    if (singleElem.type === "paragraph") {
      const parsed = parseSectionsFromText(singleElem.text);
      if (parsed.length >= 2) {
        const used = new Set(usedIndices);
        used.add(titleIndices[0]);
        const introParts: string[] = [];
        for (let j = 0; j < titleIndices[0]; j++) {
          if (!usedIndices.has(j) && j > titleElemIndex) {
            const e = elements[j];
            const textContent = e.type === "list" ? e.items.join(" ") : e.text;
            if (isTemplateArtifact(textContent)) continue;
            if (textContent === docTitle || textContent === docDescription) continue;
            if (e.type === "paragraph") introParts.push(e.text);
            else if (e.type === "heading") introParts.push(`${"#".repeat(e.level)} ${e.text}`);
            else if (e.type === "list") introParts.push(e.items.map((item) => `- ${item}`).join("\n"));
            used.add(j);
          }
        }
        return {
          introductoryContent: introParts.length > 0 ? introParts.join("\n\n") : null,
          sections: parsed,
          usedElementIndices: used,
        };
      }
    }
  }

  const used = new Set(usedIndices);
  const sections: ExtractedSectionItem[] = [];
  const introParts: string[] = [];

  const firstTitleIdx = titleIndices[0];
  for (let i = 0; i < firstTitleIdx; i++) {
    if (!usedIndices.has(i) && i > titleElemIndex) {
      const e = elements[i];
      const textContent = e.type === "list" ? e.items.join(" ") : e.text;
      if (isTemplateArtifact(textContent)) continue;
      if (textContent === docTitle || textContent === docDescription) continue;
      if (e.type === "paragraph") introParts.push(e.text);
      else if (e.type === "heading") introParts.push(`${"#".repeat(e.level)} ${e.text}`);
      else if (e.type === "list") introParts.push(e.items.map((item) => `- ${item}`).join("\n"));
      used.add(i);
    }
  }

  for (let t = 0; t < titleIndices.length; t++) {
    const currentIdx = titleIndices[t];
    const nextIdx = t + 1 < titleIndices.length ? titleIndices[t + 1] : elements.length;
    const titleElem = elements[currentIdx];
    used.add(currentIdx);

    let title = "";
    let firstBodyPart = "";

    if (titleElem.type === "paragraph") {
      const parsed = parseSectionsFromText(titleElem.text);
      if (parsed.length > 0) {
        title = parsed[0].title;
        firstBodyPart = parsed[0].content;
      } else {
        const m = titleElem.text.match(/(?:^|\r?\n|\*\*)\s*(?:Title|Section Title)\s*[:—–-]\s*(.*?)(?:\*\*|$)([\s\S]*)/i);
        if (m) {
          title = m[1].replace(/^\*\*|\*\*$/g, "").trim();
          firstBodyPart = m[2].replace(/^(?:\*\*)?\s*Content\s*[:—–-]\s*(?:\*\*)?/i, "").replace(/^\*\*|\*\*$/g, "").trim();
        }
      }
    }

    const contentParts: string[] = [];
    if (firstBodyPart) contentParts.push(firstBodyPart);

    for (let j = currentIdx + 1; j < nextIdx; j++) {
      if (usedIndices.has(j)) continue;
      const elem = elements[j];
      used.add(j);
      if (elem.type === "paragraph") {
        const text = elem.text.replace(/^(?:\*\*)?\s*Content\s*[:—–-]\s*(?:\*\*)?/i, "").trim();
        if (text) contentParts.push(text);
      } else if (elem.type === "heading") {
        contentParts.push(`${"#".repeat(elem.level)} ${elem.text}`);
      } else if (elem.type === "list") {
        for (const item of elem.items) {
          contentParts.push(`- ${item}`);
        }
      }
    }

    if (title) {
      sections.push({
        title,
        content: contentParts.join("\n\n"),
      });
    }
  }

  return sections.length > 0
    ? {
      introductoryContent: introParts.length > 0 ? introParts.join("\n\n") : null,
      sections,
      usedElementIndices: used,
    }
    : null;
}

function detectHeadingSections(
  elements: DocElement[],
  usedIndices: Set<number>,
  titleElemIndex: number,
): {
  introductoryContent: string | null;
  sections: ExtractedSectionItem[];
  usedElementIndices: Set<number>;
  ambiguousHeadings: string[];
} | null {
  const headingIndices: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    if (usedIndices.has(i) || i <= titleElemIndex) continue;
    const elem = elements[i];
    if (elem.type === "heading" && !isTemplateArtifact(elem.text)) {
      headingIndices.push(i);
    }
  }

  if (headingIndices.length === 0) return null;

  const used = new Set(usedIndices);
  const sections: ExtractedSectionItem[] = [];
  const introParts: string[] = [];
  const ambiguousHeadings: string[] = [];

  const firstHeadingIdx = headingIndices[0];
  for (let i = titleElemIndex + 1; i < firstHeadingIdx; i++) {
    if (!usedIndices.has(i)) {
      const e = elements[i];
      if (e.type === "paragraph") introParts.push(e.text);
      else if (e.type === "list") introParts.push(e.items.map((item) => `- ${item}`).join("\n"));
      used.add(i);
    }
  }

  for (let h = 0; h < headingIndices.length; h++) {
    const currentIdx = headingIndices[h];
    const nextIdx = h + 1 < headingIndices.length ? headingIndices[h + 1] : elements.length;
    const headingElem = elements[currentIdx] as { type: "heading"; level: number; text: string };
    used.add(currentIdx);

    const contentParts: string[] = [];
    for (let j = currentIdx + 1; j < nextIdx; j++) {
      if (usedIndices.has(j)) continue;
      const elem = elements[j];
      used.add(j);
      if (elem.type === "paragraph") {
        contentParts.push(elem.text);
      } else if (elem.type === "heading") {
        contentParts.push(`${"#".repeat(elem.level)} ${elem.text}`);
      } else if (elem.type === "list") {
        for (const item of elem.items) {
          contentParts.push(`- ${item}`);
        }
      }
    }

    if (contentParts.length === 0) {
      ambiguousHeadings.push(headingElem.text);
    }

    sections.push({
      title: headingElem.text,
      content: contentParts.join("\n\n"),
    });
  }

  return sections.length > 0
    ? {
      introductoryContent: introParts.length > 0 ? introParts.join("\n\n") : null,
      sections,
      usedElementIndices: used,
      ambiguousHeadings,
    }
    : null;
}

/**
 * Extract structured content from a .docx Buffer.
 * Supports both table-based templates (e.g. Blog Content Entry Template)
 * and labeled / freeform documents.
 */
export async function extractDocx(
  buffer: Buffer,
  filename: string,
): Promise<ExtractedDocument> {
  let imageCounter = 0;
  const images: ExtractedImage[] = [];

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: (mammoth.images as any).inline(async (element: any) => {
        const imgBuffer = Buffer.from(await element.read());
        const ext = element.contentType.split("/")[1] || "png";
        const idx = imageCounter++;
        images.push({
          index: idx,
          altText:
            typeof element.altText === "string" && element.altText.trim()
              ? element.altText.trim()
              : `Image ${idx + 1}`,
          caption: "",
          location: "Document",
          ...(typeof element.relationshipId === "string"
            ? { relationshipId: element.relationshipId }
            : {}),
          buffer: imgBuffer,
          contentType: element.contentType,
          filename: `image_${idx + 1}.${ext}`,
        });
        return { src: `[IMAGE_${idx}]` };
      }),
    },
  );

  const conversionErrors = result.messages
    .filter((message) => message.type === "error")
    .map((message) => message.message);
  if (conversionErrors.length) {
    throw new Error(`DOCX conversion failed: ${conversionErrors.join("; ")}`);
  }
  const html = result.value;
  const contentSections = extractContentSections(html);
  if (!validateContentSections(contentSections)) {
    throw new Error("DOCX content sections failed text and Blocks validation.");
  }
  const contentWarnings = result.messages
    .filter((message) => message.type === "warning")
    .map((message) => message.message);
  annotateImageLocations(html, images);

  const parsedFields: Partial<DocumentFields> = {};
  const fieldStates = initialFieldStates();
  const unmappedFields: Array<{ label: string; value: string }> = [];

  // Step 1: Parse table key-value pairs (highest fidelity for structured templates)
  const structuredTableIndices = new Set<number>();
  const tablePairs = parseTables(html);
  const contentNewTable = parseContentNewTable(html);
  if (contentNewTable) {
    const tableSections = extractTableSections(contentNewTable.pairs);
    if (tableSections.length > 0) {
      parsedFields.contentnew = tableSections;
      fieldStates.contentnew = {
        status: "extracted",
        reason: `Extracted ${tableSections.length} repeatable section(s) from table.`,
        rawValue: JSON.stringify(tableSections),
      };
    }
  }

  const contentNewPairs = contentNewTable?.pairs ?? [];
  for (const { key, value } of tablePairs) {
    if (contentNewPairs.some((pair) => pair.key === key && pair.value === value) &&
        (normalizeKey(key) === "title" || normalizeKey(key) === "content")) continue;
    if (!assignField(parsedFields, fieldStates, key, value) && value.trim()) {
      unmappedFields.push({ label: key, value });
    }
  }

  // Step 2: Parse document blocks in source order without flattening tables into adjacent paragraphs.
  type DocElement =
    | { type: "heading"; level: number; text: string }
    | { type: "paragraph"; text: string }
    | { type: "list"; items: string[] }
    | { type: "table"; text: string; tableIndex: number };

  const headings: Array<{ level: number; text: string }> = [];
  const paragraphs: string[] = [];
  const lists: string[][] = [];
  const elements: DocElement[] = [];
  const documentNodes = parseDocument(html, { decodeEntities: true }).children;
  let tableIndex = 0;
  for (const node of documentNodes) {
    if (!isElement(node)) continue;
    const tag = node.name.toLowerCase();
    if (tag === "table") {
      const text = readableTableText(node);
      if (text && !structuredTableIndices.has(tableIndex)) {
        elements.push({ type: "table", text, tableIndex });
      }
      tableIndex += 1;
    } else if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag.substring(1), 10);
      const text = readableNodeText(node).trim();
      if (text) {
        headings.push({ level, text });
        elements.push({ type: "heading", level, text });
      }
    } else if (tag === "p") {
      const text = readableNodeText(node).trim();
      if (text && (!text.startsWith("[IMAGE_") || /^\[IMAGE_\d+\]$/i.test(text))) {
        paragraphs.push(text);
        elements.push({ type: "paragraph", text });
      }
    } else if (tag === "ul" || tag === "ol") {
      const items = node.children
        .filter((child): child is Element => isElement(child) && child.name === "li")
        .map((item) => readableNodeText(item).trim())
        .filter(Boolean);
      if (items.length > 0) {
        lists.push(items);
        elements.push({ type: "list", items });
      }
    }
  }

  // Step 4: Parse non-table elements and filter template artifacts
  const explicitSectionTitleIndices = new Set<number>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (
      el.type === "paragraph" &&
      /(?:^|\r?\n|\*\*)\s*(?:Title|Section Title)\s*[:—–-]/i.test(el.text)
    ) {
      explicitSectionTitleIndices.add(i);
    }
  }
  const firstExplicitSectionTitleIndex =
    Array.from(explicitSectionTitleIndices)[0] ?? -1;
  const hasExplicitSections =
    explicitSectionTitleIndices.size >= 2 ||
    elements.some(
      (el) => el.type === "paragraph" && parseSectionsFromText(el.text).length > 0,
    ) ||
    (explicitSectionTitleIndices.size === 1 &&
      elements.some(
        (el, index) =>
          index < firstExplicitSectionTitleIndex &&
          el.type === "heading" &&
          el.level === 1,
      )
    );

  const usedElementIndices = new Set<number>();
  let currentMetadataSection:
    "faq" | "author" | "seo" | "form" | "button" | null = null;
  const faqItems: string[] = [];
  const formItems: string[] = [];
  const authorItems: string[] = [];
  const seoItems: string[] = [];
  const buttonItems: string[] = [];

  for (let i = 0; i < elements.length; i++) {
    if (usedElementIndices.has(i)) continue;
    const elem = elements[i];
    const elemText = elem.type === "list" ? elem.items.join(" ") : elem.text;

    // Filter out known template instructions and headers (e.g. "Blog Content Entry Template", "Blog Details", "5. Default SEO")
    if (isTemplateArtifact(elemText)) {
      usedElementIndices.add(i);
      continue;
    }

    if (elem.type === "heading") {
      const lower = elem.text.toLowerCase().trim();
      if (
        lower === "faq" ||
        lower === "frequently asked questions" ||
        lower.startsWith("faq:")
      ) {
        currentMetadataSection = "faq";
        usedElementIndices.add(i);
        continue;
      } else if (
        lower === "author" ||
        lower === "author data" ||
        lower === "about the author"
      ) {
        currentMetadataSection = "author";
        usedElementIndices.add(i);
        continue;
      } else if (
        lower === "seo" ||
        lower === "seo metadata" ||
        lower === "default seo" ||
        lower === "metadata"
      ) {
        currentMetadataSection = "seo";
        usedElementIndices.add(i);
        continue;
      } else if (
        lower === "form" ||
        lower === "form section" ||
        lower === "form configuration"
      ) {
        currentMetadataSection = "form";
        usedElementIndices.add(i);
        continue;
      } else if (
        lower === "buttons" ||
        lower === "button" ||
        lower === "call to action"
      ) {
        currentMetadataSection = "button";
        usedElementIndices.add(i);
        continue;
      } else {
        currentMetadataSection = null;
      }
    }

    if (elem.type === "paragraph") {
      const labeled = parseLabeledField(elem.text);
      if (
        labeled &&
        (normalizeKey(labeled.label) === "title" ||
          normalizeKey(labeled.label) === "content" ||
          normalizeKey(labeled.label) === "sectiontitle")
      ) {
        if (hasExplicitSections || parsedFields.title) {
          // Leave for section extraction
          continue;
        }
      }
      const next = elements[i + 1];
      if (
        labeled &&
        !labeled.value &&
        next?.type === "paragraph" &&
        /^\[IMAGE_\d+\]$/i.test(next.text)
      ) {
        assignField(parsedFields, fieldStates, labeled.label, next.text);
        usedElementIndices.add(i);
        usedElementIndices.add(i + 1);
        continue;
      }
      if (
        labeled &&
        assignField(parsedFields, fieldStates, labeled.label, labeled.value)
      ) {
        usedElementIndices.add(i);
        continue;
      }
    }

    if (
      (elem.type === "heading" || elem.type === "paragraph") &&
      FIELD_ALIASES[normalizeKey(elemText)]
    ) {
      // A Contentnew heading names a container/section in the template; its
      // following Title and Content rows are parsed as component entries.
      // Treating the heading as a field label here creates a false duplicate.
      if (normalizeKey(elemText) === "contentnew") {
        usedElementIndices.add(i);
        continue;
      }
      const next = elements[i + 1];
      if (next && next.type !== "heading") {
        const value = next.type === "list" ? next.items.join("\n") : next.text;
        assignField(parsedFields, fieldStates, elemText, value);
        usedElementIndices.add(i);
        usedElementIndices.add(i + 1);
      } else {
        assignField(parsedFields, fieldStates, elemText, "");
        usedElementIndices.add(i);
      }
      continue;
    }

    if (currentMetadataSection) {
      usedElementIndices.add(i);
      const textContent =
        elem.type === "list" ? elem.items.join("\n") : elem.text;
      if (currentMetadataSection === "faq") faqItems.push(textContent);
      else if (currentMetadataSection === "author")
        authorItems.push(textContent);
      else if (currentMetadataSection === "seo") seoItems.push(textContent);
      else if (currentMetadataSection === "form") formItems.push(textContent);
      else if (currentMetadataSection === "button")
        buttonItems.push(textContent);
      continue;
    }

    // Check for image placeholder
    if (elem.type === "paragraph" && isImagePlaceholder(elem.text)) {
      usedElementIndices.add(i);
      assignField(parsedFields, fieldStates, "cover", elem.text);
      continue;
    }

    if (elem.type === "paragraph") {
      if (/^\[IMAGE_\d+\]$/i.test(elem.text)) {
        usedElementIndices.add(i);
        continue;
      }
      const labeled = parseLabeledField(elem.text);
      if (labeled && labeled.value) unmappedFields.push(labeled);
    }
  }

  if (faqItems.length && fieldStates.faqsection.status === "missing") {
    assignField(parsedFields, fieldStates, "faqsection", faqItems.join("\n\n"));
  }
  if (formItems.length && fieldStates.formsection.status === "missing") {
    assignField(
      parsedFields,
      fieldStates,
      "formsection",
      formItems.join("\n\n"),
    );
  }
  if (authorItems.length && fieldStates.authordata.status === "missing") {
    assignField(
      parsedFields,
      fieldStates,
      "authordata",
      authorItems.join("\n"),
    );
  }
  if (buttonItems.length && fieldStates.button.status === "missing") {
    assignField(parsedFields, fieldStates, "button", buttonItems.join("\n"));
  }
  if (seoItems.length) {
    unmappedFields.push({ label: "SEO section", value: seoItems.join("\n\n") });
  }

  // Step 4: Resolve Title (if not already found in table or label)
  let title = parsedFields.title ?? null;
  let titleElemIndex = -1;

  if (!title && fieldStates.title.status === "missing") {
    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i];
      if (
        elem.type === "heading" &&
        elem.level === 1 &&
        !usedElementIndices.has(i) &&
        !isTemplateArtifact(elem.text)
      ) {
        title = elem.text;
        titleElemIndex = i;
        usedElementIndices.add(i);
        break;
      }
    }

    if (!title && fieldStates.title.status === "missing") {
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        if (
          elem.type === "heading" &&
          !usedElementIndices.has(i) &&
          !isTemplateArtifact(elem.text)
        ) {
          title = elem.text;
          titleElemIndex = i;
          usedElementIndices.add(i);
          break;
        }
      }
    }

    if (!title && fieldStates.title.status === "missing") {
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        if (
          elem.type === "paragraph" &&
          !usedElementIndices.has(i) &&
          !isTemplateArtifact(elem.text)
        ) {
          title = elem.text;
          titleElemIndex = i;
          usedElementIndices.add(i);
          break;
        }
      }
    }
  }
  parsedFields.title = title;
  if (title && fieldStates.title.status === "missing") {
    fieldStates.title = {
      status: "extracted",
      reason: "Inferred from the document heading.",
      rawValue: title,
    };
  }

  // Step 5: Resolve Description (if not already found in table or label)
  let description = parsedFields.description ?? null;
  if (!description && fieldStates.description.status === "missing") {
    for (let i = 0; i < elements.length; i++) {
      if (i <= titleElemIndex) continue;
      const elem = elements[i];
      if (
        elem.type === "paragraph" &&
        !usedElementIndices.has(i) &&
        !isTemplateArtifact(elem.text)
      ) {
        description = elem.text;
        usedElementIndices.add(i);
        break;
      }
    }
  }
  parsedFields.description = description;
  if (description && fieldStates.description.status === "missing") {
    fieldStates.description = {
      status: "extracted",
      reason: "Inferred from the first remaining paragraph.",
      rawValue: description,
    };
  }

  // Save used elements before section detection so full body elements can still be resolved for doc.content
  const usedBeforeSections = new Set(usedElementIndices);

  // Step 6.5: Extract Repeatable ContentNew Sections (before resolving general content)
  let introductoryContent: string | null = null;
  const ambiguousHeadings: string[] = [];

  if (!parsedFields.contentnew && fieldStates.contentnew.status === "missing") {
    const explicitResult = detectExplicitSections(
      elements,
      usedElementIndices,
      titleElemIndex,
      title,
      description,
    );
    if (explicitResult && explicitResult.sections.length > 0) {
      parsedFields.contentnew = explicitResult.sections;
      fieldStates.contentnew = {
        status: "extracted",
        reason: `Extracted ${explicitResult.sections.length} repeatable section(s).`,
        rawValue: JSON.stringify(explicitResult.sections),
      };
      introductoryContent = explicitResult.introductoryContent;
      for (const idx of explicitResult.usedElementIndices) {
        usedElementIndices.add(idx);
      }
    } else {
      const headingResult = detectHeadingSections(elements, usedElementIndices, titleElemIndex);
      if (headingResult && headingResult.sections.length > 0) {
        parsedFields.contentnew = headingResult.sections;
        fieldStates.contentnew = {
          status: "extracted",
          reason: `Extracted ${headingResult.sections.length} repeatable section(s) from document headings.`,
          rawValue: JSON.stringify(headingResult.sections),
        };
        introductoryContent = headingResult.introductoryContent;
        if (headingResult.ambiguousHeadings.length > 0) {
          ambiguousHeadings.push(...headingResult.ambiguousHeadings);
        }
        for (const idx of headingResult.usedElementIndices) {
          usedElementIndices.add(idx);
        }
      }
    }
  }

  // Step 7: Resolve Content (main body)
  // doc.content holds the full body content of the document
  let content = parsedFields.content ?? null;

  if (!content) {
    const contentParts: string[] = [];
    for (let i = 0; i < elements.length; i++) {
      if (usedBeforeSections.has(i)) continue;

      const elem = elements[i];
      if (elem.type === "heading") {
        const prefix = "#".repeat(elem.level);
        contentParts.push(`${prefix} ${elem.text}`);
      } else if (elem.type === "paragraph") {
        contentParts.push(elem.text);
      } else if (elem.type === "list") {
        for (const item of elem.items) {
          contentParts.push(`- ${item}`);
        }
      } else if (elem.type === "table") {
        contentParts.push(elem.text);
      }
    }
    content = contentParts.length > 0 ? contentParts.join("\n\n") : null;
  }

  // Keep explicitly supplied template fields authoritative. Only infer intro text
  // from the document body when the template did not provide a root `content` value.
  if (parsedFields.contentnew && Array.isArray(parsedFields.contentnew)) {
    const hasExplicitContentField = fieldStates.content.status !== "missing";
    if (hasExplicitContentField) {
      // `parsedFields.content` was extracted from its own labeled field; do not
      // replace it with inferred text (which may be null) just because contentNew exists.
    } else if (introductoryContent) {
      parsedFields.content = introductoryContent;
      fieldStates.content = {
        status: "extracted",
        reason: "Preserved introductory blog content.",
        rawValue: introductoryContent,
      };
    } else {
      parsedFields.content = null;
      fieldStates.content = {
        status: "explicitly_empty",
        reason: "All body content mapped to repeatable contentNew sections.",
      };
    }
  } else {
    parsedFields.content = content;
    if (content && fieldStates.content.status === "missing") {
      fieldStates.content = {
        status: "extracted",
        reason: "Preserved from remaining document body content.",
        rawValue: content,
      };
    }
  }

  const referencedCoverIndex = fieldStates.cover.imageIndex;
  if (
    referencedCoverIndex !== undefined &&
    !images.some((image) => image.index === referencedCoverIndex)
  ) {
    fieldStates.cover = {
      status: "invalid",
      reason: `Cover references embedded image ${referencedCoverIndex}, which was not extracted.`,
      rawValue: fieldStates.cover.rawValue,
    };
  }

  const rawText = stripHtml(html);
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  return {
    title,
    description,
    slug: parsedFields.slug ?? null,
    content,
    headings,
    paragraphs,
    lists,
    contentSections,
    contentWarnings,
    images,
    rawText,
    metadata: {
      wordCount,
      hasImages: images.length > 0,
      extractedAt: new Date().toISOString(),
      filename: path.basename(filename),
    },
    parsedFields,
    fieldStates,
    unmappedFields,
    ambiguousHeadings: ambiguousHeadings.length > 0 ? ambiguousHeadings : undefined,
  };
}

function stripHtml(html: string): string {
  const withLinks = html.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis,
    (_match, href: string, label: string) => {
      const linkText = stripHtml(label);
      const linkTarget = decodeHtmlEntities(href);
      return /^(https?:\/\/|mailto:|\/|#)/i.test(linkTarget)
        ? `[${linkText}](${linkTarget})`
        : linkText;
    },
  );
  return withLinks
    .replace(/<img\b[^>]*src=["'](\[IMAGE_\d+\])["'][^>]*>/gi, " $1 ")
    .replace(/<(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/(strong|b)>/gi, "**")
    .replace(/<(em|i)\b[^>]*>/gi, "*")
    .replace(/<\/(em|i)>/gi, "*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function annotateImageLocations(html: string, images: ExtractedImage[]): void {
  const imageTag = /<img\b[^>]*src=["']\[IMAGE_(\d+)\]["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imageTag.exec(html)) !== null) {
    const image = images[Number(match[1])];
    if (!image) continue;

    const before = html.slice(0, match.index);
    const paragraphStart = before.lastIndexOf("<p");
    const rowStart = before.lastIndexOf("<tr");
    const rowEnd = rowStart >= 0 ? html.indexOf("</tr>", match.index) : -1;
    const hasTableRow = rowStart >= 0 && rowEnd >= match.index;
    const start = hasTableRow
      ? rowStart
      : Math.max(paragraphStart, before.lastIndexOf("<h"));
    const end = hasTableRow
      ? rowEnd + "</tr>".length
      : (() => {
        const after = html.slice(match.index + match[0].length);
        const elementEnd = after.search(/<\/(?:p|h[1-6])>/i);
        return (
          match.index + match[0].length + (elementEnd >= 0 ? elementEnd : 0)
        );
      })();
    const context = start >= 0 ? html.slice(start, end) : match[0];
    const nearbyText = stripHtml(context)
      .replace(/\[IMAGE_\d+\]/gi, "")
      .trim();
    const previousElement = before
      .match(/<(?:p|h[1-6])\b[^>]*>[\s\S]*?<\/(?:p|h[1-6])>/gi)
      ?.at(-1);
    const contextText =
      nearbyText || (previousElement ? stripHtml(previousElement).trim() : "");
    const location = hasTableRow
      ? `Table row ${(html.slice(0, rowStart).match(/<tr\b/gi)?.length ?? 0) + 1}`
      : paragraphStart >= 0
        ? `Paragraph ${html.slice(0, paragraphStart).match(/<p\b/gi)?.length ?? 1}`
        : "Document";
    image.location = contextText
      ? `${location}: ${contextText.substring(0, 120)}`
      : location;
    if (contextText) image.caption = contextText.substring(0, 250);
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
