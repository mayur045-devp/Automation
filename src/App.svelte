<script>
  import { onMount } from 'svelte'
  import ConnectionStatus from './lib/ConnectionStatus.svelte'
  import SchemaExplorer from './lib/SchemaExplorer.svelte'
  import DataViewer from './lib/DataViewer.svelte'
  import ImportPage from './lib/ImportPage.svelte'
  import { pingStrapi, fetchStrapiSchema } from './lib/strapiQueries.js'

  let activeTab = 'explorer' // 'explorer' | 'import'

  const GRAPHQL_URL = import.meta.env.VITE_STRAPI_GRAPHQL_URL || 'http://localhost:1337/graphql'
  const GRAPHQL_ORIGIN = (() => {
    try { return new URL(GRAPHQL_URL).origin } catch { return '' }
  })()

  // Connection state
  let connectionStatus = 'idle'   // idle | loading | connected | error
  let responseTime = null
  let schemaFields = []
  let connectError = null
  let hasConnected = false
  let connectionVersion = 0

  async function connect() {
    connectionVersion += 1
    connectionStatus = 'loading'
    connectError = null
    responseTime = null
    schemaFields = []

    const start = performance.now()
    const ping = await pingStrapi()
    const elapsed = Math.round(performance.now() - start)

    if (ping.error) {
      connectionStatus = 'error'
      connectError = ping.error
      return
    }

    responseTime = elapsed
    connectionStatus = 'connected'
    hasConnected = true

    // Fetch schema for explorer
    const schema = await fetchStrapiSchema()
    if (schema.data) {
      schemaFields = schema.data.__schema?.queryType?.fields || []
    }
  }

  // Auto-connect on mount
  onMount(() => {
    connect()
  })
</script>

<!-- Background -->
<div class="grid-bg" style="min-height: 100vh; padding: 0;">
  <!-- Glow blobs -->
  <div class="glow-blob" style="top: -100px; left: -100px;"></div>
  <div class="glow-blob" style="bottom: -100px; right: -100px; background: radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 70%);"></div>

  <!-- Top nav -->
  <nav style="border-bottom: 1px solid var(--border); backdrop-filter: blur(16px); background: rgba(10,10,15,0.8); position: sticky; top: 0; z-index: 50;">
    <div class="mx-auto px-6 py-4 flex items-center justify-between site-nav-inner" style="max-width: 1200px;">
      <div class="flex items-center gap-3">
        <!-- Logo -->
        <div class="w-8 h-8 rounded-lg flex items-center justify-center"
             style="background: linear-gradient(135deg, #6366f1, #8b5cf6);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="font-bold text-sm" style="color: var(--text-primary);">Strapi GraphQL Explorer</span>
        <span class="tag" style="font-size: 0.65rem;">Svelte + TailwindCSS</span>
      </div>

      <!-- Tab switcher -->
      <div class="flex items-center gap-1" style="background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 10px; padding: 4px;">
        <button
          class="btn text-xs px-3 py-1.5"
          style="border-radius: 7px; transition: background 0.2s; {activeTab === 'explorer' ? 'background: linear-gradient(135deg,#6366f1,#8b5cf6); color:white;' : 'background:transparent; color:var(--text-muted);'}"
          on:click={() => activeTab = 'explorer'}
        >GraphQL Explorer</button>
        <button
          class="btn text-xs px-3 py-1.5"
          style="border-radius: 7px; transition: background 0.2s; {activeTab === 'import' ? 'background: linear-gradient(135deg,#6366f1,#8b5cf6); color:white;' : 'background:transparent; color:var(--text-muted);'}"
          on:click={() => activeTab = 'import'}
        >📄 Word Import</button>
      </div>

      <div class="flex items-center gap-3">
        <a href="http://localhost:1337/admin" target="_blank"
           class="btn btn-ghost text-xs px-3 py-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Strapi Admin
        </a>
        <button
          class="btn btn-primary text-xs px-3 py-2"
          on:click={connect}
          disabled={connectionStatus === 'loading'}
        >
          {#if connectionStatus === 'loading'}
            <div class="spinner" style="width:13px;height:13px;"></div>
            Connecting…
          {:else}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M23 7l-7 5 7 5V7z"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            {connectionStatus === 'connected' ? 'Reconnect' : 'Connect'}
          {/if}
        </button>
      </div>
    </div>
  </nav>

  <!-- Main content -->
  <main class="mx-auto px-6 py-10 flex flex-col gap-8" style="max-width: 1200px;">

  {#if activeTab === 'import'}
    <ImportPage
      {connectionStatus}
      connectionOrigin={GRAPHQL_ORIGIN}
      {connectionVersion}
    />
  {:else}

    <!-- Hero -->
    <div class="fade-in">
      <div class="section-label mb-2">Strapi × Svelte × GraphQL</div>
      <h1 class="text-3xl font-bold mb-2" style="color: var(--text-primary); line-height: 1.2;">
        GraphQL Connection
        <span style="background: linear-gradient(135deg, #6366f1, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          Tester
        </span>
      </h1>
      <p class="text-sm" style="color: var(--text-secondary); max-width: 500px; line-height: 1.6;">
        Verify that your Svelte frontend can reach your Strapi backend via GraphQL.
        Explore the schema and query any collection live.
      </p>
    </div>

    <!-- Config info strip -->
    <div class="rounded-2xl px-5 py-4 flex flex-wrap gap-6"
         style="background: var(--bg-card); border: 1px solid var(--border);">
      <div class="flex flex-col gap-1">
        <span class="section-label">GraphQL Endpoint</span>
        <span class="text-xs font-mono" style="color: var(--accent-light)">{GRAPHQL_URL}</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="section-label">Framework</span>
        <span class="text-xs font-semibold" style="color: var(--text-secondary)">Svelte + Vite</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="section-label">Styling</span>
        <span class="text-xs font-semibold" style="color: var(--text-secondary)">TailwindCSS v4</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="section-label">HTTP Client</span>
        <span class="text-xs font-semibold" style="color: var(--text-secondary)">graphql-request</span>
      </div>
    </div>

    <!-- Two-column layout -->
    <div class="grid gap-6" style="grid-template-columns: 1fr 1fr;">
      <!-- Left: connection + schema -->
      <div class="flex flex-col gap-4">
        <ConnectionStatus
          status={connectionStatus}
          endpoint={GRAPHQL_URL}
          {responseTime}
        />

        {#if connectError}
          <div class="rounded-xl p-4 text-xs font-mono"
               style="background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); color: var(--error);">
            {connectError}
          </div>
        {/if}

        <!-- How-to card -->
        <div class="glass-card p-5 flex flex-col gap-3">
          <h3 class="text-sm font-semibold" style="color: var(--text-primary)">Quick Setup Guide</h3>
          <ol class="flex flex-col gap-2.5">
            {#each [
              { n: 1, text: 'Start Strapi: run `npm run develop` in your Strapi project' },
              { n: 2, text: 'Enable GraphQL plugin in Strapi (`npm install @strapi/plugin-graphql`)' },
              { n: 3, text: 'Set public permissions for your content-types in Admin → Settings → Roles → Public' },
              { n: 4, text: 'Click "Connect" or wait for auto-connect on page load' },
              { n: 5, text: 'Use the Data Query panel to fetch records from any collection' },
            ] as step}
              <li class="flex gap-3 text-xs" style="color: var(--text-secondary);">
                <span class="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                      style="background: var(--accent-glow); color: var(--accent-light);">{step.n}</span>
                {step.text}
              </li>
            {/each}
          </ol>
        </div>

        <SchemaExplorer fields={schemaFields} />
      </div>

      <!-- Right: Data Viewer -->
      <div>
        <DataViewer disabled={connectionStatus !== 'connected'} />
      </div>
    </div>
  {/if}

    <!-- Raw env info (helpful during development) -->
    <details class="glass-card p-4 text-xs" style="color: var(--text-muted);">
      <summary class="cursor-pointer font-medium" style="color: var(--text-secondary);">
        🔧 Environment Variables (dev)
      </summary>
      <div class="mt-3 flex flex-col gap-1 font-mono">
        <div>VITE_STRAPI_URL = {import.meta.env.VITE_STRAPI_URL || '(not set)'}</div>
        <div>VITE_STRAPI_GRAPHQL_URL = {import.meta.env.VITE_STRAPI_GRAPHQL_URL || '(not set)'}</div>
        <div>VITE_STRAPI_TOKEN = {import.meta.env.VITE_STRAPI_TOKEN ? '*** (set)' : '(not set — public access mode)'}</div>
      </div>
    </details>
  </main>

  <!-- Footer -->
  <footer class="text-center py-6 text-xs" style="color: var(--text-muted); border-top: 1px solid var(--border);">
    Svelte + Vite + TailwindCSS + graphql-request → Strapi GraphQL API
  </footer>
</div>
