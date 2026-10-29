<script>
  import { sanitizePreviewHtml } from './sanitizePreviewHtml.js';

  export let contentHtml = '';
  export let content = [];

  function safeInline(nodes) {
    return sanitizePreviewHtml((Array.isArray(nodes) ? nodes : []).map(renderInlineNode).join(''));
  }

  function renderInlineNode(node) {
    if (node?.type === 'text') {
      let text = escapeHtml(String(node.text ?? ''));
      if (node.code) text = `<code>${text}</code>`;
      if (node.strikethrough) text = `<s>${text}</s>`;
      if (node.underline) text = `<u>${text}</u>`;
      if (node.italic) text = `<em>${text}</em>`;
      if (node.bold) text = `<strong>${text}</strong>`;
      return text;
    }
    if (node?.type === 'link') {
      const children = (Array.isArray(node.children) ? node.children : []).map(renderInlineNode).join('');
      return safeHref(node.url)
        ? `<a href="${escapeHtml(node.url)}">${children}</a>`
        : children;
    }
    return '';
  }

  function safeHref(value) {
    return typeof value === 'string' &&
      /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(value.trim());
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
</script>

<div class="content-new-renderer">
  {#if contentHtml}
    {@html sanitizePreviewHtml(contentHtml)}
  {:else}
    {#each content as block}
      {#if block.type === 'paragraph'}
        <p>{@html safeInline(block.children ?? [])}</p>
      {:else if block.type === 'heading' && Number(block.level) >= 1 && Number(block.level) <= 6}
        <svelte:element this={`h${block.level}`}>{@html safeInline(block.children ?? [])}</svelte:element>
      {:else if block.type === 'list' && (block.format === 'ordered' || block.format === 'unordered')}
        <svelte:element this={block.format === 'ordered' ? 'ol' : 'ul'}>
          {#each block.children ?? [] as item}
            <li>{@html safeInline(item.children ?? [])}</li>
          {/each}
        </svelte:element>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .content-new-renderer {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-wrap: anywhere;
    color: inherit;
  }

  :global(.content-new-renderer table) {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
  }

  :global(.content-new-renderer th),
  :global(.content-new-renderer td) {
    min-width: 7rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.32);
    text-align: left;
    vertical-align: top;
  }

  :global(.content-new-renderer th) {
    background: rgba(99, 102, 241, 0.12);
    font-weight: 600;
  }

  :global(.content-new-renderer p) { margin: 0.35rem 0; }
  :global(.content-new-renderer a) { color: #a5b4fc; text-decoration: underline; }
  :global(.content-new-renderer ul),
  :global(.content-new-renderer ol) { padding-left: 1.4rem; }
</style>
