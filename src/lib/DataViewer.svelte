<script>
  /**
   * DataViewer — lets user type a collection name & fields,
   * runs a live GraphQL query against Strapi, and shows results
   */
  import { fetchCollection } from './strapiQueries.js'

  export let disabled = false

  let collectionName = 'articles'
  let fieldsInput = 'Title'
  let loading = false
  let result = null
  let error = null
  let queryStr = ''

  export async function runQuery() {
    if (!collectionName.trim()) return
    loading = true
    error = null
    result = null

    const fields = fieldsInput
      .split(',')
      .map(f => f.trim())
      .filter(Boolean)

    const fieldList = ['documentId', ...fields].join('\n      ')
    queryStr = `query Fetch_${collectionName} {\n  ${collectionName} {\n      ${fieldList}\n  }\n}`

    const res = await fetchCollection(collectionName.trim(), fields)
    loading = false

    if (res.error) {
      error = res.error
    } else {
      result = res.data
    }
  }

  // Count total records
  $: recordCount = result
    ? Object.values(result).reduce((acc, val) => acc + (Array.isArray(val) ? val.length : 1), 0)
    : 0

  $: prettyResult = result ? JSON.stringify(result, null, 2) : null
</script>

<div class="glass-card p-5 flex flex-col gap-5">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="font-semibold text-sm" style="color: var(--text-primary)">Live Data Query</h3>
      <p class="text-xs mt-0.5" style="color: var(--text-muted)">Fetch data from any Strapi collection</p>
    </div>
    <!-- Quick preset button -->
    <button
      class="btn btn-ghost text-xs py-1 px-2.5"
      on:click={() => {
        collectionName = 'articles'
        fieldsInput = 'Title'
        runQuery()
      }}
      disabled={disabled || loading}
    >
      Load Articles
    </button>
  </div>

  <!-- Form -->
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-1.5">
      <label class="section-label" for="collection-input">Collection Name</label>
      <input
        id="collection-input"
        class="input"
        type="text"
        bind:value={collectionName}
        placeholder="e.g. articles, usersPermissionsUsers"
        disabled={disabled || loading}
        on:keydown={(e) => e.key === 'Enter' && runQuery()}
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="section-label" for="fields-input">Fields (comma-separated, case-sensitive)</label>
      <input
        id="fields-input"
        class="input"
        type="text"
        bind:value={fieldsInput}
        placeholder="Title, description, slug"
        disabled={disabled || loading}
        on:keydown={(e) => e.key === 'Enter' && runQuery()}
      />
    </div>

    <button
      class="btn btn-primary"
      on:click={runQuery}
      disabled={disabled || loading || !collectionName.trim()}
    >
      {#if loading}
        <div class="spinner" style="width:16px;height:16px;"></div>
        Fetching…
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Run Query
      {/if}
    </button>
  </div>

  <!-- Query Preview -->
  {#if queryStr}
    <div class="flex flex-col gap-1.5">
      <span class="section-label">Generated Query</span>
      <pre class="code-block">{queryStr}</pre>
    </div>
  {/if}

  <!-- Results -->
  {#if error}
    <div class="rounded-xl p-4 flex flex-col gap-2"
         style="background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2);">
      <div class="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span class="text-sm font-medium" style="color: var(--error)">Query Error</span>
      </div>
      <p class="text-xs font-mono" style="color: rgba(239,68,68,0.8); word-break: break-all;">{error}</p>
    </div>
  {/if}

  {#if result}
    <div class="flex flex-col gap-4 fade-in">
      <!-- Summary -->
      <div class="flex items-center justify-between">
        <span class="section-label">Live Data from Strapi</span>
        <span class="tag" style="background: rgba(34,197,94,0.15); color: #22c55e; border-color: rgba(34,197,94,0.3);">
          ✓ {recordCount} record{recordCount !== 1 ? 's' : ''} received
        </span>
      </div>

      <!-- Cards for each collection -->
      {#each Object.entries(result) as [key, items]}
        {#if Array.isArray(items) && items.length > 0}
          <div class="flex flex-col gap-2">
            <span class="section-label" style="color: var(--accent-light)">{key}</span>
            <div class="flex flex-col gap-2 stagger">
              {#each items as item}
                <div class="rounded-xl p-4"
                     style="background: var(--bg-secondary); border: 1px solid var(--border-glow);">
                  {#each Object.entries(item) as [field, value]}
                    {#if value !== null && value !== undefined}
                      <div class="flex items-start gap-3 text-xs mb-1.5">
                        <span class="font-mono font-semibold" style="color: var(--accent-light); min-width: 110px;">{field}:</span>
                        <span style="color: var(--text-primary); font-size: 0.85rem; font-weight: {field === 'Title' ? '600' : '400'}; word-break: break-all;">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      <!-- Raw JSON -->
      <div class="flex flex-col gap-1.5">
        <span class="section-label">Raw JSON</span>
        <pre class="code-block" style="max-height: 250px; overflow-y: auto;">{prettyResult}</pre>
      </div>
    </div>
  {/if}
</div>
