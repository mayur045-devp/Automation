import mammoth from 'mammoth';
import path from 'path';
import { DOCUMENT_FIELD_KEYS, DOCUMENT_FIELD_MAPPINGS, slugify } from './schema';
import type { DocumentFields, DocumentFieldKey, FieldState, FieldStates } from './schema';

export interface ExtractedImage {
  index: number;
  altText: string;
  caption: string;
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
}

/**
 * Check if text represents an image placeholder or empty instruction rather than a real image asset.
 * e.g. [Optional cover photo: AI technology] or "Leave empty — add/select the cover image in Strapi."
 */
export function isImagePlaceholder(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith('[optional cover photo') ||
    lower.startsWith('[cover photo') ||
    lower.startsWith('[optional cover image') ||
    lower.startsWith('[cover image') ||
    lower.startsWith('[optional image') ||
    lower.startsWith('[image:') ||
    lower.startsWith('[image_') ||
    lower.startsWith('leave empty')
  );
}

/**
 * Identify template structural artifacts, headers, or instructions that should NEVER
 * be treated as title, description, or article body content.
 */
export function isTemplateArtifact(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower === 'blog content entry template' ||
    lower.includes('content entry template') ||
    lower.includes('fields marked "leave empty"') ||
    lower.includes('sample values are provided') ||
    lower === 'blog details' ||
    lower === 'default seo' ||
    lower === '5. default seo' ||
    lower.startsWith('5. default seo') ||
    lower === 'content & page components' ||
    lower.startsWith('content & page components') ||
    lower === '1. title' ||
    lower === '2. description' ||
    lower === '3. slug' ||
    lower === '4. cover [image]'
  );
}

/**
 * Normalize a table cell key or label name.
 * e.g. "1. Title" -> "title", "4. Cover [Image]" -> "cover", "metaTitle" -> "metatitle"
 */
export function normalizeKey(key: string): string {
  return key
    .replace(/^\d+[\.\)]\s*/, '') // remove leading "1. " or "1) "
    .replace(/\[.*?\]/g, '')     // remove "[Image]"
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');  // remove spaces, colons, hyphens
}

/**
 * Normalize a field value. Detects "Leave empty" instructions and returns null.
 */
export function normalizeValue(val: string): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('leave empty') ||
    lower === '[leave empty]' ||
    lower === 'empty' ||
    lower === 'empty.' ||
    lower === 'no provided value' ||
    lower === 'no provided value.' ||
    lower === 'not provided' ||
    lower === 'n/a' ||
    lower === 'none' ||
    lower === '(none)'
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Try to parse a labeled line like "Author: John Doe" or "SEO Title - My Title".
 */
export function parseLabeledField(text: string): { label: string; value: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^([A-Za-z0-9\s\.\[\]]+?)\s*([:—–-])\s*(.*)$/);
  if (!match) return null;
  const label = normalizeKey(match[1]);
  if (match[2] !== ':' && !FIELD_ALIASES[label]) return null;
  const value = match[3].trim();
  return { label, value };
}

const FIELD_ALIASES: Record<string, DocumentFieldKey> = Object.fromEntries(
  DOCUMENT_FIELD_MAPPINGS.flatMap(({ label, aliases = [], internalField }) =>
    [label, ...aliases].map((alias) => [normalizeKey(alias), internalField])
  )
);

function initialFieldStates(): FieldStates {
  return Object.fromEntries(
    DOCUMENT_FIELD_KEYS.map((key) => [key, { status: 'missing' as const }])
  );
}

function classifyFieldValue(
  key: DocumentFieldKey,
  rawValue: string
): { state: FieldState; value: string | null } {
  const value = rawValue.trim();
  const imageMatch = value.match(/^\[IMAGE_(\d+)\]$/i);
  if (key === 'cover' && imageMatch) {
    return {
      state: {
        status: 'extracted',
        reason: 'Image is explicitly placed in the Cover field.',
        rawValue: value,
        imageIndex: Number(imageMatch[1]),
      },
      value: null,
    };
  }

  if (!value) {
    return { state: { status: 'explicitly_empty', rawValue }, value: null };
  }

  const lower = value.toLowerCase();
  if (/^(empty|no provided value|not provided|n\/a|none|\(none\)|\[leave empty\])\.?$/.test(lower)) {
    return { state: { status: 'explicitly_empty', rawValue }, value: null };
  }
  if (
    lower.startsWith('leave empty') ||
    lower.startsWith('select ') ||
    lower.startsWith('add ') ||
    lower.startsWith('connect ') ||
    lower.startsWith('choose ') ||
    lower.startsWith('[optional') ||
    lower.startsWith('[cover') ||
    lower.startsWith('[image')
  ) {
    return {
      state: { status: 'unresolved', reason: 'Template instruction or placeholder, not a field value.', rawValue },
      value: null,
    };
  }

  if (key === 'cover' || key === 'defaultSeo.shareImage') {
    return {
      state: { status: 'unresolved', reason: 'Media fields require an explicitly referenced embedded image or manual selection.', rawValue },
      value: null,
    };
  }
  if (key === 'blogcategories') {
    return {
      state: { status: 'unresolved', reason: 'Category text cannot safely resolve the current Article relation.', rawValue },
      value,
    };
  }
  if (key === 'contentnew') {
    return {
      state: { status: 'requires_review', reason: 'The target component expects structured Blocks content.', rawValue },
      value,
    };
  }
  if (key === 'faqsection' || key === 'formsection' || key === 'popularityname') {
    return {
      state: { status: 'unresolved', reason: 'No matching attribute exists in the current Strapi Article schema.', rawValue },
      value,
    };
  }
  if (key === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { state: { status: 'invalid', reason: 'Expected a date in YYYY-MM-DD format.', rawValue }, value };
  }
  if (key === 'date') {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      return { state: { status: 'invalid', reason: 'Date is not a valid calendar date.', rawValue }, value };
    }
  }
  if (key === 'slug' && !slugify(value)) {
    return { state: { status: 'invalid', reason: 'Slug contains no usable URL characters.', rawValue }, value };
  }
  if (key === 'button' && !(/^https?:\/\/\S+$/i.test(value) || /^\/[^/\s][^\s]*$/.test(value) || /^#[^\s]+$/.test(value))) {
    return { state: { status: 'requires_review', reason: 'Button value is not a verified URL/path for button.link.', rawValue }, value };
  }

  return { state: { status: 'extracted', rawValue }, value };
}

function assignField(
  fields: Partial<DocumentFields>,
  states: FieldStates,
  label: string,
  rawValue: string
): boolean {
  const key = FIELD_ALIASES[normalizeKey(label)];
  if (!key) return false;

  const classified = classifyFieldValue(key, rawValue);
  const existing = states[key];
  if (
    existing &&
    existing.status !== 'missing' &&
    existing.rawValue !== undefined &&
    existing.rawValue !== rawValue.trim()
  ) {
    states[key] = {
      status: 'requires_review',
      reason: `Conflicting duplicate values for "${label}".`,
      rawValue: `${existing.rawValue}\n${rawValue.trim()}`,
    };
    return true;
  }
  states[key] = classified.state;

  const value = classified.value;
  if (key.startsWith('defaultSeo.')) {
    const seoKey = key.slice('defaultSeo.'.length) as keyof NonNullable<DocumentFields['defaultSeo']>;
    const seo = fields.defaultSeo ?? {};
    if (seoKey === 'keywords') {
      seo.keywords = value
        ? value.split(/[,;]\s*/).map((part) => part.trim()).filter(Boolean)
        : [];
    } else {
      seo[seoKey] = value;
    }
    fields.defaultSeo = seo;
    return true;
  }

  switch (key) {
    case 'title': fields.title = value; break;
    case 'description': fields.description = value; break;
    case 'slug': fields.slug = value; break;
    case 'cover': fields.cover = value; break;
    case 'content': fields.content = value; break;
    case 'date': fields.date = value; break;
    case 'authordata': fields.authordata = value; break;
    case 'categoryname': fields.categoryname = value; break;
    case 'contentnew': fields.contentnew = value; break;
    case 'button': fields.button = value; break;
    case 'buttontitle': fields.buttontitle = value; break;
    case 'buttonsubtitle': fields.buttonsubtitle = value; break;
    case 'blogcategories':
      fields.blogcategories = value && value.includes(',')
        ? value.split(',').map((part) => part.trim()).filter(Boolean)
        : value;
      break;
    case 'time': fields.time = value; break;
    case 'faqsection': fields.faqsection = value; break;
    case 'formsection': fields.formsection = value; break;
    case 'popularityname': fields.popularityname = value; break;
  }
  return true;
}

/**
 * Parse 2-column tables from Mammoth HTML into key-value pairs.
 */
function parseTables(html: string): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const trRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      const rowHtml = trMatch[1];
      const cells: string[] = [];
      const tdRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
      let tdMatch: RegExpExecArray | null;

      while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
        cells.push(stripHtml(tdMatch[1]).trim());
      }

      if (cells.length >= 2) {
        const key = cells[0];
        // If there are more than 2 cells, join remaining as value
        const value = cells.slice(1).join(' ').trim();
        if (key) {
          pairs.push({ key, value });
        }
      }
    }
  }

  return pairs;
}

/**
 * Extract structured content from a .docx Buffer.
 * Supports both table-based templates (e.g. Blog Content Entry Template)
 * and labeled / freeform documents.
 */
export async function extractDocx(
  buffer: Buffer,
  filename: string
): Promise<ExtractedDocument> {
  let imageCounter = 0;
  const images: ExtractedImage[] = [];

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: (mammoth.images as any).inline(async (element: any) => {
        const imgBuffer = Buffer.from(await element.read());
        const ext = element.contentType.split('/')[1] || 'png';
        const idx = imageCounter++;
        images.push({
          index: idx,
          altText: `Image ${idx + 1}`,
          caption: '',
          buffer: imgBuffer,
          contentType: element.contentType,
          filename: `image_${idx + 1}.${ext}`,
        });
        return { src: `[IMAGE_${idx}]` };
      }),
    }
  );

  const html = result.value;

  const parsedFields: Partial<DocumentFields> = {};
  const fieldStates = initialFieldStates();
  const unmappedFields: Array<{ label: string; value: string }> = [];

  // Step 1: Parse table key-value pairs (highest fidelity for structured templates)
  const tablePairs = parseTables(html);
  for (const { key, value } of tablePairs) {
    if (!assignField(parsedFields, fieldStates, key, value) && value.trim()) {
      unmappedFields.push({ label: key, value });
    }
  }
  // Step 2: Strip <table>...</table> from HTML so table contents don't pollute paragraph stream
  const htmlWithoutTables = html.replace(/<table[^>]*>.*?<\/table>/gis, ' ');

  // Step 3: Parse remaining elements in document order
  type DocElement =
    | { type: 'heading'; level: number; text: string }
    | { type: 'paragraph'; text: string }
    | { type: 'list'; items: string[] };

  const headings: Array<{ level: number; text: string }> = [];
  const paragraphs: string[] = [];
  const lists: string[][] = [];
  const elements: DocElement[] = [];

  const elemRegex = /<(h[1-6]|p|[uo]l)[^>]*>(.*?)<\/\1>/gis;
  let match: RegExpExecArray | null;

  while ((match = elemRegex.exec(htmlWithoutTables)) !== null) {
    const tag = match[1].toLowerCase();
    const innerHtml = match[2];

    if (tag.startsWith('h')) {
      const level = parseInt(tag.substring(1), 10);
      const text = stripHtml(innerHtml);
      if (text) {
        headings.push({ level, text });
        elements.push({ type: 'heading', level, text });
      }
    } else if (tag === 'p') {
      const text = stripHtml(innerHtml);
      if (text && !text.startsWith('[IMAGE_')) {
        paragraphs.push(text);
        elements.push({ type: 'paragraph', text });
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const items: string[] = [];
      const liRegex = /<li[^>]*>(.*?)<\/li>/gis;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(innerHtml)) !== null) {
        const itemText = stripHtml(liMatch[1]);
        if (itemText) items.push(itemText);
      }
      if (items.length > 0) {
        lists.push(items);
        elements.push({ type: 'list', items });
      }
    }
  }

  // Step 4: Parse non-table elements and filter template artifacts
  const usedElementIndices = new Set<number>();
  let currentMetadataSection: 'faq' | 'author' | 'seo' | 'form' | 'button' | null = null;
  const faqItems: string[] = [];
  const formItems: string[] = [];
  const authorItems: string[] = [];
  const seoItems: string[] = [];
  const buttonItems: string[] = [];

  for (let i = 0; i < elements.length; i++) {
    if (usedElementIndices.has(i)) continue;
    const elem = elements[i];
    const elemText = elem.type === 'list' ? elem.items.join(' ') : elem.text;

    // Filter out known template instructions and headers (e.g. "Blog Content Entry Template", "Blog Details", "5. Default SEO")
    if (isTemplateArtifact(elemText)) {
      usedElementIndices.add(i);
      continue;
    }

    if (elem.type === 'heading') {
      const lower = elem.text.toLowerCase().trim();
      if (lower === 'faq' || lower === 'frequently asked questions' || lower.startsWith('faq:')) {
        currentMetadataSection = 'faq';
        usedElementIndices.add(i);
        continue;
      } else if (lower === 'author' || lower === 'author data' || lower === 'about the author') {
        currentMetadataSection = 'author';
        usedElementIndices.add(i);
        continue;
      } else if (lower === 'seo' || lower === 'seo metadata' || lower === 'default seo' || lower === 'metadata') {
        currentMetadataSection = 'seo';
        usedElementIndices.add(i);
        continue;
      } else if (lower === 'form' || lower === 'form section' || lower === 'form configuration') {
        currentMetadataSection = 'form';
        usedElementIndices.add(i);
        continue;
      } else if (lower === 'buttons' || lower === 'button' || lower === 'call to action') {
        currentMetadataSection = 'button';
        usedElementIndices.add(i);
        continue;
      } else {
        currentMetadataSection = null;
      }
    }

    if (elem.type === 'paragraph') {
      const labeled = parseLabeledField(elem.text);
      if (labeled && assignField(parsedFields, fieldStates, labeled.label, labeled.value)) {
        usedElementIndices.add(i);
        continue;
      }
    }

    if ((elem.type === 'heading' || elem.type === 'paragraph') && FIELD_ALIASES[normalizeKey(elemText)]) {
      const next = elements[i + 1];
      if (next && next.type !== 'heading') {
        const value = next.type === 'list' ? next.items.join('\n') : next.text;
        assignField(parsedFields, fieldStates, elemText, value);
        usedElementIndices.add(i);
        usedElementIndices.add(i + 1);
      } else {
        assignField(parsedFields, fieldStates, elemText, '');
        usedElementIndices.add(i);
      }
      continue;
    }

    if (currentMetadataSection) {
      usedElementIndices.add(i);
      const textContent = elem.type === 'list' ? elem.items.join('\n') : elem.text;
      if (currentMetadataSection === 'faq') faqItems.push(textContent);
      else if (currentMetadataSection === 'author') authorItems.push(textContent);
      else if (currentMetadataSection === 'seo') seoItems.push(textContent);
      else if (currentMetadataSection === 'form') formItems.push(textContent);
      else if (currentMetadataSection === 'button') buttonItems.push(textContent);
      continue;
    }

    // Check for image placeholder
    if (elem.type === 'paragraph' && isImagePlaceholder(elem.text)) {
      usedElementIndices.add(i);
      assignField(parsedFields, fieldStates, 'cover', elem.text);
      continue;
    }

    if (elem.type === 'paragraph') {
      const labeled = parseLabeledField(elem.text);
      if (labeled && labeled.value) unmappedFields.push(labeled);
    }
  }

  if (faqItems.length && fieldStates.faqsection.status === 'missing') {
    assignField(parsedFields, fieldStates, 'faqsection', faqItems.join('\n\n'));
  }
  if (formItems.length && fieldStates.formsection.status === 'missing') {
    assignField(parsedFields, fieldStates, 'formsection', formItems.join('\n\n'));
  }
  if (authorItems.length && fieldStates.authordata.status === 'missing') {
    assignField(parsedFields, fieldStates, 'authordata', authorItems.join('\n'));
  }
  if (buttonItems.length && fieldStates.button.status === 'missing') {
    assignField(parsedFields, fieldStates, 'button', buttonItems.join('\n'));
  }
  if (seoItems.length) {
    unmappedFields.push({ label: 'SEO section', value: seoItems.join('\n\n') });
  }

  // Step 5: Resolve Title (if not already found in table or label)
  let title = parsedFields.title ?? null;
  let titleElemIndex = -1;

  if (!title && fieldStates.title.status === 'missing') {
    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i];
      if (
        elem.type === 'heading' &&
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

    if (!title && fieldStates.title.status === 'missing') {
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        if (
          elem.type === 'heading' &&
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

    if (!title && fieldStates.title.status === 'missing') {
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        if (
          elem.type === 'paragraph' &&
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
  if (title && fieldStates.title.status === 'missing') {
    fieldStates.title = { status: 'extracted', reason: 'Inferred from the document heading.', rawValue: title };
  }

  // Step 6: Resolve Description (if not already found in table or label)
  let description = parsedFields.description ?? null;
  if (!description && fieldStates.description.status === 'missing') {
    for (let i = 0; i < elements.length; i++) {
      if (i <= titleElemIndex) continue;
      const elem = elements[i];
      if (
        elem.type === 'paragraph' &&
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
  if (description && fieldStates.description.status === 'missing') {
    fieldStates.description = { status: 'extracted', reason: 'Inferred from the first remaining paragraph.', rawValue: description };
  }

  // Step 7: Resolve Content (main body ONLY)
  // If content was explicitly set via table, prioritize that
  let content = parsedFields.content ?? null;

  // Otherwise, collect remaining non-metadata, non-template elements
  if (!content && fieldStates.content.status === 'missing') {
    const contentParts: string[] = [];
    for (let i = 0; i < elements.length; i++) {
      if (usedElementIndices.has(i)) continue;

      const elem = elements[i];
      if (elem.type === 'heading') {
        const prefix = '#'.repeat(elem.level);
        contentParts.push(`${prefix} ${elem.text}`);
      } else if (elem.type === 'paragraph') {
        contentParts.push(elem.text);
      } else if (elem.type === 'list') {
        for (const item of elem.items) {
          contentParts.push(`- ${item}`);
        }
      }
    }
    content = contentParts.length > 0 ? contentParts.join('\n\n') : null;
  }
  parsedFields.content = content;
  if (content && fieldStates.content.status === 'missing') {
    fieldStates.content = { status: 'extracted', reason: 'Preserved from remaining document body content.', rawValue: content };
  }

  const referencedCoverIndex = fieldStates.cover.imageIndex;
  if (referencedCoverIndex !== undefined && !images.some((image) => image.index === referencedCoverIndex)) {
    fieldStates.cover = {
      status: 'invalid',
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
    }
  );
  return withLinks
    .replace(/<(strong|b)\b[^>]*>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)\b[^>]*>/gi, '*')
    .replace(/<\/(em|i)>/gi, '*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
