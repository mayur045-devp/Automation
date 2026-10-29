const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'i', 'li', 'ol', 'p', 's', 'strong', 'sub', 'sup', 'table', 'tbody',
  'span', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math']);

export function sanitizePreviewHtml(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');
  for (const child of parsed.body.childNodes) {
    const safeNode = copySafeNode(child);
    if (safeNode) container.appendChild(safeNode);
  }
  return container.innerHTML;
}

function copySafeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const tag = node.tagName.toLowerCase();
  if (DROP_TAGS.has(tag)) return null;
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = document.createDocumentFragment();
    for (const child of node.childNodes) {
      const safeChild = copySafeNode(child);
      if (safeChild) fragment.appendChild(safeChild);
    }
    return fragment;
  }

  const safeElement = document.createElement(tag);
  if (tag === 'a') {
    const href = safeHref(node.getAttribute('href'));
    if (href) {
      safeElement.setAttribute('href', href);
      safeElement.setAttribute('rel', 'noopener noreferrer');
    }
  } else if (tag === 'td' || tag === 'th') {
    for (const attribute of ['colspan', 'rowspan']) {
      const value = Number.parseInt(node.getAttribute(attribute) ?? '', 10);
      if (Number.isInteger(value) && value >= 1 && value <= 100) {
        safeElement.setAttribute(attribute, String(value));
      }
    }
  }
  for (const child of node.childNodes) {
    const safeChild = copySafeNode(child);
    if (safeChild) safeElement.appendChild(safeChild);
  }
  return safeElement;
}

function safeHref(value) {
  if (!value) return null;
  const href = value.trim();
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) ? href : null;
}
