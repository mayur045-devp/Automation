import mammoth from 'mammoth';
import path from 'path';
import type { DocumentFields } from './schema';

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
}

let imageCounter = 0;

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
  const match = trimmed.match(/^([A-Za-z0-9\s\.\[\]]+?)\s*[:—–-]\s*(.+)$/);
  if (!match) return null;
  const label = normalizeKey(match[1]);
  const value = match[2].trim();
  return { label, value };
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
  imageCounter = 0;
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

  const parsedFields: Partial<DocumentFields> = {
    defaultSeo: {
      metaTitle: null,
      metaDescription: null,
      keywords: [],
      metaRobots: null,
      structuredData: null,
      metaViewPort: null,
      canonicalURL: null,
      shareImage: null,
    },
  };

  // Step 1: Parse table key-value pairs (highest fidelity for structured templates)
  const tablePairs = parseTables(html);
  for (const { key, value } of tablePairs) {
    const normK = normalizeKey(key);
    const normV = normalizeValue(value);

    switch (normK) {
      case 'title':
        if (normV) parsedFields.title = normV;
        break;
      case 'description':
      case 'summary':
      case 'abstract':
        if (normV) parsedFields.description = normV;
        break;
      case 'slug':
        if (normV) parsedFields.slug = normV;
        break;
      case 'cover':
      case 'coverimage':
        parsedFields.cover = null; // placeholders become null
        break;
      case 'metatitle':
      case 'seotitle':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaTitle = normV;
        break;
      case 'metadescription':
      case 'seodescription':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaDescription = normV;
        break;
      case 'keywords':
        if (parsedFields.defaultSeo) {
          parsedFields.defaultSeo.keywords = normV
            ? normV.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        }
        break;
      case 'metarobots':
      case 'robots':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaRobots = normV;
        break;
      case 'structureddata':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.structuredData = normV;
        break;
      case 'metaviewport':
      case 'viewport':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaViewPort = normV;
        break;
      case 'canonicalurl':
      case 'canonical':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.canonicalURL = normV;
        break;
      case 'shareimage':
        if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.shareImage = normV;
        break;
      case 'content':
      case 'maincontent':
        parsedFields.content = normV;
        break;
      case 'contentnew':
        parsedFields.contentnew = normV;
        break;
      case 'author':
      case 'authordata':
      case 'by':
        parsedFields.authordata = normV;
        break;
      case 'date':
      case 'publisheddate':
        parsedFields.date = normV;
        break;
      case 'category':
      case 'categoryname':
        parsedFields.categoryname = normV;
        break;
      case 'categories':
      case 'blogcategories':
        parsedFields.blogcategories = normV
          ? normV.includes(',')
            ? normV.split(',').map((s) => s.trim()).filter(Boolean)
            : normV
          : null;
        break;
      case 'button':
      case 'buttontext':
        parsedFields.button = normV;
        break;
      case 'buttontitle':
        parsedFields.buttontitle = normV;
        break;
      case 'buttonsubtitle':
        parsedFields.buttonsubtitle = normV;
        break;
      case 'time':
      case 'readtime':
        parsedFields.time = normV;
        break;
      case 'faq':
      case 'faqsection':
        parsedFields.faqsection = normV;
        break;
      case 'form':
      case 'formsection':
        parsedFields.formsection = normV;
        break;
      case 'popularity':
      case 'popularityname':
        parsedFields.popularityname = normV;
        break;
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
      parsedFields.cover = null;
      continue;
    }

    // Check for labeled lines
    if (elem.type === 'paragraph') {
      const labeled = parseLabeledField(elem.text);
      if (labeled) {
        const { label, value } = labeled;
        const normV = normalizeValue(value);
        let matched = true;

        switch (label) {
          case 'title':
            if (normV && !parsedFields.title) parsedFields.title = normV;
            break;
          case 'description':
          case 'summary':
          case 'abstract':
            if (normV && !parsedFields.description) parsedFields.description = normV;
            break;
          case 'slug':
            if (normV && !parsedFields.slug) parsedFields.slug = normV;
            break;
          case 'author':
          case 'authordata':
          case 'by':
            if (normV) parsedFields.authordata = normV;
            break;
          case 'date':
          case 'publisheddate':
          case 'published':
            if (normV) parsedFields.date = normV;
            break;
          case 'category':
          case 'categoryname':
            if (normV) parsedFields.categoryname = normV;
            break;
          case 'categories':
          case 'blogcategories':
            if (normV) {
              parsedFields.blogcategories = normV.includes(',')
                ? normV.split(',').map((s) => s.trim()).filter(Boolean)
                : normV;
            }
            break;
          case 'seotitle':
          case 'metatitle':
            if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaTitle = normV;
            break;
          case 'seodescription':
          case 'metadescription':
            if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaDescription = normV;
            break;
          case 'keywords':
            if (parsedFields.defaultSeo && normV) {
              parsedFields.defaultSeo.keywords = normV
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            }
            break;
          case 'robots':
          case 'metarobots':
            if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.metaRobots = normV;
            break;
          case 'canonicalurl':
          case 'canonical':
            if (parsedFields.defaultSeo && normV) parsedFields.defaultSeo.canonicalURL = normV;
            break;
          case 'button':
          case 'buttontext':
            if (normV) parsedFields.button = normV;
            break;
          case 'buttontitle':
            if (normV) parsedFields.buttontitle = normV;
            break;
          case 'buttonsubtitle':
            if (normV) parsedFields.buttonsubtitle = normV;
            break;
          case 'faq':
          case 'frequentlyaskedquestions':
            if (normV) faqItems.push(normV);
            break;
          case 'form':
          case 'formsection':
            if (normV) formItems.push(normV);
            break;
          case 'time':
          case 'readtime':
            if (normV) parsedFields.time = normV;
            break;
          case 'popularity':
          case 'popularityname':
            if (normV) parsedFields.popularityname = normV;
            break;
          case 'contentnew':
            if (normV) parsedFields.contentnew = normV;
            break;
          default:
            matched = false;
        }

        if (matched) {
          usedElementIndices.add(i);
        }
      }
    }
  }

  // Populate accumulated sections into parsedFields if not already set by tables
  if (faqItems.length > 0 && !parsedFields.faqsection) parsedFields.faqsection = faqItems.join('\n\n');
  if (formItems.length > 0 && !parsedFields.formsection) parsedFields.formsection = formItems.join('\n\n');
  if (authorItems.length > 0 && !parsedFields.authordata) parsedFields.authordata = authorItems.join('\n');
  if (buttonItems.length > 0 && !parsedFields.button) parsedFields.button = buttonItems.join('\n');
  if (seoItems.length > 0 && parsedFields.defaultSeo && !parsedFields.defaultSeo.metaDescription) {
    parsedFields.defaultSeo.metaDescription = seoItems.join(' ');
  }

  // Step 5: Resolve Title (if not already found in table or label)
  let title = parsedFields.title ?? null;
  let titleElemIndex = -1;

  if (!title) {
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

    if (!title) {
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

    if (!title) {
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

  // Step 6: Resolve Description (if not already found in table or label)
  let description = parsedFields.description ?? null;
  if (!description) {
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

  // Step 7: Resolve Content (main body ONLY)
  // If content was explicitly set via table, prioritize that
  let content = parsedFields.content ?? null;

  // Otherwise, collect remaining non-metadata, non-template elements
  if (!content) {
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
  };
}

function stripHtml(html: string): string {
  return html
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
