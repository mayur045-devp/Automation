<script>
  /**
   * SchemaExplorer — shows all query fields (collections) discovered
   * via GraphQL introspection from Strapi
   */
  export let fields = []

  // Filter out internal Strapi fields (starting with __ or upload/i18n internals)
  $: filtered = fields.filter(f =>
    !f.name.startsWith('__') &&
    !f.name.startsWith('upload') &&
    !f.name.startsWith('i18N') &&
    !f.name.startsWith('entityNotesDocument') &&
    f.name !== 'me' &&
    f.name !== 'reviewWorkflowsWorkflow' &&
    f.name !== 'reviewWorkflowsWorkflows'
  )

  const typeColors = {
    OBJECT: { bg: 'rgba(99,102,241,0.12)', color: '#818cf8', border: 'rgba(99,102,241,0.25)' },
    LIST: { bg: 'rgba(34,197,94,0.1)', color: '#4ade80', border: 'rgba(34,197,94,0.25)' },
    SCALAR: { bg: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: 'rgba(245,158,11,0.25)' },
  }
  function getTypeStyle(kind) {
    return typeColors[kind] || typeColors.SCALAR
  }
</script>

<div class="glass-card p-5 flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="font-semibold text-sm" style="color: var(--text-primary)">Schema Explorer</h3>
      <p class="text-xs mt-0.5" style="color: var(--text-muted)">Available collections & queries</p>
    </div>
    <span class="tag">{filtered.length} fields</span>
  </div>

  {#if filtered.length === 0}
    <div class="text-sm text-center py-6" style="color: var(--text-muted)">
      No schema data yet. Connect to Strapi first.
    </div>
  {:else}
    <div class="flex flex-col gap-2 stagger" style="max-height: 340px; overflow-y: auto;">
      {#each filtered as field}
        {@const style = getTypeStyle(field.type?.kind)}
        <div class="flex items-start justify-between px-3 py-2.5 rounded-xl"
             style="background: var(--bg-secondary); border: 1px solid var(--border);">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium font-mono" style="color: var(--text-primary)">{field.name}</span>
            {#if field.description}
              <span class="text-xs" style="color: var(--text-muted)">{field.description}</span>
            {/if}
          </div>
          {#if field.type?.kind}
            <span class="text-xs font-semibold px-2 py-0.5 rounded-md"
                  style="background: {style.bg}; color: {style.color}; border: 1px solid {style.border};">
              {field.type.kind}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
