import { parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";

export interface StrapiTextNode {
  type: "text";
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strikethrough?: true;
  code?: true;
}

export interface StrapiLinkNode {
  type: "link";
  url: string;
  children: StrapiTextNode[];
}

export interface StrapiParagraphBlock {
  type: "paragraph";
  children: Array<StrapiTextNode | StrapiLinkNode>;
}

export interface StrapiHeadingBlock {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: Array<StrapiTextNode | StrapiLinkNode>;
}

export interface StrapiListItemBlock {
  type: "list-item";
  children: Array<StrapiTextNode | StrapiLinkNode>;
}

export interface StrapiListBlock {
  type: "list";
  format: "ordered" | "unordered";
  children: StrapiListItemBlock[];
}

export type StrapiContentBlock =
  | StrapiParagraphBlock
  | StrapiHeadingBlock
  | StrapiListBlock;

export interface ContentSection {
  title: string;
  content: string;
  blocks: StrapiContentBlock[];
  warnings: string[];
}

export function contentSectionToText(section: ContentSection): string {
  return section.content;
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol"]);

interface SectionBoundary {
  index: number;
  title: string;
}

export function extractContentSections(html: string): ContentSection[] {
  const document = parseDocument(html, { decodeEntities: true });
  const children = document.children;
  const boundaries = findSectionBoundaries(children);
  if (!boundaries.length) return [];

  const warnings: string[] = [];
  const sections: ContentSection[] = [];
  const headingIndices = children.flatMap((node, index) =>
    isElement(node) && /^h[1-6]$/.test(node.name) && textContent(node).trim()
      ? [{ index, title: textContent(node).trim() }]
      : [],
  );
  const ignoredHeading = getDocumentTitleIndex(children, headingIndices);
  const firstBoundaryIndex = boundaries[0].index;

  for (let sectionIndex = 0; sectionIndex < boundaries.length; sectionIndex++) {
    const boundary = boundaries[sectionIndex];
    const end = boundaries[sectionIndex + 1]?.index ?? children.length;
    const contentNodes = [
      ...(sectionIndex === 0
        ? children.slice(0, firstBoundaryIndex).filter((_node, index) => index !== ignoredHeading)
        : []),
      ...children.slice(boundary.index + 1, end),
    ];
    const sectionWarnings: string[] = [];
    sections.push({
      title: boundary.title,
      content: nodesToText(contentNodes),
      blocks: nodesToBlocks(contentNodes, sectionWarnings),
      warnings: [...new Set(sectionWarnings)],
    });
    warnings.push(...sectionWarnings);
  }

  if (warnings.length) {
    for (const section of sections) {
      section.warnings = [...new Set(section.warnings)];
    }
  }
  return sections;
}

export function validateContentSections(value: unknown): value is ContentSection[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (section) =>
      isRecord(section) &&
      typeof section.title === "string" &&
      section.title.trim().length > 0 &&
      typeof section.content === "string" &&
      Array.isArray(section.blocks) &&
      section.blocks.every(isValidBlock) &&
      Array.isArray(section.warnings) &&
      section.warnings.every((warning) => typeof warning === "string"),
  );
}

export function validateContentNewComponents(value: unknown): boolean {
  return Array.isArray(value) && value.every(
    (component) =>
      isRecord(component) &&
      hasOnlyKeys(component, ["title", "content"]) &&
      typeof component.title === "string" &&
      component.title.trim().length > 0 &&
      typeof component.content === "string",
  );
}

function findSectionBoundaries(nodes: AnyNode[]): SectionBoundary[] {
  const headingIndices = nodes.flatMap((node, index) =>
    isElement(node) && /^h[1-6]$/.test(node.name) && textContent(node).trim()
      ? [{ index, title: textContent(node).trim() }]
      : [],
  );
  const documentTitleIndex = getDocumentTitleIndex(nodes, headingIndices);
  const sectionHeadings = headingIndices.filter(({ index }) => index !== documentTitleIndex);

  const markdownHeadings = nodes.flatMap((node, index) => {
    if (!isElement(node) || node.name !== "p") return [];
    const match = textContent(node).trim().match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    return match ? [{ index, title: match[1].trim() }] : [];
  });

  const boldParagraphs = nodes.flatMap((node, index) =>
    isElement(node) && node.name === "p" && isStandaloneBoldParagraph(node)
      ? [{ index, title: textContent(node).trim() }]
      : [],
  );
  const headings = [...sectionHeadings, ...markdownHeadings, ...boldParagraphs];
  if (headings.length) {
    return deduplicateBoundaries(headings);
  }

  return nodes.flatMap((node, index) => {
    if (!isElement(node) || node.name !== "p" || !isStandaloneBoldParagraph(node)) {
      return [];
    }
    const title = textContent(node).trim();
    return title ? [{ index, title }] : [];
  });
}

function getDocumentTitleIndex(
  nodes: AnyNode[],
  headings: Array<{ index: number; title: string }>,
): number {
  const firstHeading = headings[0];
  const firstHeadingNode = firstHeading ? nodes[firstHeading.index] : undefined;
  if (!firstHeading || !firstHeadingNode || !isElement(firstHeadingNode) || firstHeadingNode.name !== "h1") {
    return -1;
  }
  const hasDeeperHeading = headings.some(
    ({ index }) => isElement(nodes[index]) && /^h[2-6]$/.test(nodes[index].name),
  );
  const hasBoldSection = nodes.some(
    (node, index) => index > firstHeading.index && isElement(node) &&
      node.name === "p" && isStandaloneBoldParagraph(node),
  );
  return hasDeeperHeading || hasBoldSection ? firstHeading.index : -1;
}

function deduplicateBoundaries(boundaries: SectionBoundary[]): SectionBoundary[] {
  const byIndex = new Map<number, string>();
  for (const boundary of boundaries) {
    if (!byIndex.has(boundary.index)) byIndex.set(boundary.index, boundary.title);
  }
  return [...byIndex].map(([index, title]) => ({ index, title })).sort((a, b) => a.index - b.index);
}

function isStandaloneBoldParagraph(element: Element): boolean {
  if (element.name !== "p") return false;
  let hasText = false;
  let allTextBold = true;
  const visit = (node: AnyNode, bold: boolean): void => {
    if (node.type === "text") {
      if (node.data.trim()) {
        hasText = true;
        if (!bold) allTextBold = false;
      }
      return;
    }
    if (!isElement(node)) return;
    const nestedBold = bold || node.name === "strong" || node.name === "b";
    for (const child of node.children) visit(child, nestedBold);
  };
  visit(element, false);
  const title = textContent(element).trim();
  return hasText && allTextBold && title.length <= 180;
}

function nodesToBlocks(nodes: AnyNode[], warnings: string[]): StrapiContentBlock[] {
  const blocks: StrapiContentBlock[] = [];
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.name === "table") {
      const text = nodesToText([node]);
      if (text) blocks.push({ type: "paragraph", children: [{ type: "text", text }] });
      continue;
    }
    if (/^h[1-6]$/.test(node.name)) {
      const children = inlineNodes(node.children, warnings);
      if (children.length) {
        blocks.push({
          type: "heading",
          level: Number(node.name.slice(1)) as StrapiHeadingBlock["level"],
          children,
        });
      }
    } else if (node.name === "p") {
      const children = inlineNodes(node.children, warnings);
      if (children.length) blocks.push({ type: "paragraph", children });
    } else if (node.name === "ul" || node.name === "ol") {
      const items = node.children
        .filter((child): child is Element => isElement(child) && child.name === "li")
        .map((item) => ({
          type: "list-item" as const,
          children: inlineNodes(item.children, warnings),
        }))
        .filter((item) => item.children.length > 0);
      if (items.length) {
        blocks.push({
          type: "list",
          format: node.name === "ol" ? "ordered" : "unordered",
          children: items,
        });
      }
    } else if (!BLOCK_TAGS.has(node.name)) {
      const text = textContent(node).trim();
      if (text) blocks.push({ type: "paragraph", children: [{ type: "text", text }] });
    }
  }
  return blocks;
}

function nodesToText(nodes: AnyNode[]): string {
  const inlineText = (children: AnyNode[]): string => children.map((node) => {
    if (node.type === "text") return node.data;
    if (!isElement(node)) return "";
    if (node.name === "img") {
      return `[Image: ${node.attribs.alt?.trim() || "embedded image"}]`;
    }
    if (node.name === "br") return "\n";
    const text = inlineText(node.children);
    if (node.name === "a") {
      const url = safeUrl(node.attribs.href);
      return url ? `[${text}](${url})` : text;
    }
    if (node.name === "strong" || node.name === "b") return `**${text}**`;
    if (node.name === "em" || node.name === "i") return `*${text}*`;
    if (node.name === "s") return `~~${text}~~`;
    if (node.name === "u") return `<u>${text}</u>`;
    return text;
  }).join("");

  const blockText = (node: AnyNode): string => {
    if (!isElement(node)) return "";
    if (node.name === "table") {
      const rows: string[] = [];
      const collectRows = (element: Element): void => {
        for (const child of element.children) {
          if (!isElement(child)) continue;
          if (child.name === "table" && child !== node) {
            const nested = blockText(child);
            if (nested) rows.push(nested);
          } else if (child.name === "tr") {
            const cells = child.children
              .filter((cell): cell is Element => isElement(cell) && ["td", "th"].includes(cell.name))
              .map((cell) => cell.children
                .map((content) => blockText(content) || inlineText([content]))
                .filter(Boolean)
                .join(" ")
                .trim());
            rows.push(`| ${cells.join(" | ")} |`);
          } else {
            collectRows(child);
          }
        }
      };
      collectRows(node);
      return rows.join("\n");
    }
    if (node.name === "ul" || node.name === "ol") {
      return node.children
        .filter((child): child is Element => isElement(child) && child.name === "li")
        .map((item, index) => {
          const itemContent = item.children
            .map((child) => isElement(child) && ["ul", "ol"].includes(child.name)
              ? blockText(child)
              : blockText(child) || inlineText([child]))
            .filter(Boolean)
            .join(" ");
          return `${node.name === "ol" ? `${index + 1}.` : "-"} ${itemContent.trim()}`;
        })
        .join("\n");
    }
    if (/^h[1-6]$/.test(node.name)) {
      return `${"#".repeat(Number(node.name.slice(1)))} ${inlineText(node.children).trim()}`;
    }
    if (node.name === "p" || node.name === "blockquote") {
      return inlineText(node.children).trim();
    }
    return node.children.map(blockText).filter(Boolean).join("\n\n");
  };

  return nodes.map(blockText).filter(Boolean).join("\n\n").trim();
}

function inlineNodes(nodes: AnyNode[], warnings: string[]): Array<StrapiTextNode | StrapiLinkNode> {
  const result: Array<StrapiTextNode | StrapiLinkNode> = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.data) result.push({ type: "text", text: node.data });
      continue;
    }
    if (!isElement(node)) continue;
    if (node.name === "a") {
      const url = safeUrl(node.attribs.href);
      const children = inlineNodes(node.children, warnings).flatMap((child) =>
        child.type === "link" ? child.children : [child],
      );
      if (url && children.length) result.push({ type: "link", url, children });
      else if (children.length) {
        warnings.push("A hyperlink with an unsupported URL was converted to plain text.");
        result.push(...children);
      }
      continue;
    }
    if (node.name === "br") {
      result.push({ type: "text", text: "\n" });
      continue;
    }
    const marks = {
      ...(node.name === "strong" || node.name === "b" ? { bold: true as const } : {}),
      ...(node.name === "em" || node.name === "i" ? { italic: true as const } : {}),
      ...(node.name === "u" ? { underline: true as const } : {}),
      ...(node.name === "s" ? { strikethrough: true as const } : {}),
      ...(node.name === "code" ? { code: true as const } : {}),
    };
    const children = inlineNodes(node.children, warnings);
    for (const child of children) {
      if (child.type === "text") result.push({ ...child, ...marks });
      else result.push(child);
    }
  }
  return result;
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  const url = value.trim();
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url) ? url : null;
}

function textContent(node: AnyNode): string {
  if (node.type === "text") return node.data;
  if (!isElement(node)) return "";
  return node.children.map(textContent).join("");
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}

function isValidBlock(block: unknown): boolean {
  if (!isRecord(block) || !Array.isArray(block.children)) return false;
  if (block.type === "heading") {
    if (!hasOnlyKeys(block, ["type", "level", "children"])) return false;
    if (![1, 2, 3, 4, 5, 6].includes(block.level as number)) return false;
  } else if (block.type === "list") {
    if (!hasOnlyKeys(block, ["type", "format", "children"])) return false;
    if (block.format !== "ordered" && block.format !== "unordered") return false;
    return block.children.every((item) =>
      isRecord(item) && item.type === "list-item" &&
      hasOnlyKeys(item, ["type", "children"]) &&
      Array.isArray(item.children) && item.children.every(isValidInlineNode),
    );
  } else if (block.type !== "paragraph") {
    return false;
  } else if (!hasOnlyKeys(block, ["type", "children"])) {
    return false;
  }
  return block.children.every(isValidInlineNode);
}

function isValidInlineNode(node: unknown): boolean {
  if (!isRecord(node)) return false;
  if (node.type === "text") {
    return hasOnlyKeys(node, ["type", "text", "bold", "italic", "underline", "strikethrough", "code"]) &&
      typeof node.text === "string" &&
      ["bold", "italic", "underline", "strikethrough", "code"].every(
        (mark) => node[mark] === undefined || node[mark] === true,
      );
  }
  return node.type === "link" && hasOnlyKeys(node, ["type", "url", "children"]) &&
    typeof node.url === "string" && safeUrl(node.url) === node.url &&
    Array.isArray(node.children) && node.children.every(
      (child) => isRecord(child) && isValidInlineNode(child) && child.type === "text",
    );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
