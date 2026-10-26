<script>
  /**
   * ConnectionStatus component
   * Shows the live connection state to Strapi GraphQL
   */
  export let status = 'idle' // 'idle' | 'loading' | 'connected' | 'error'
  export let endpoint = ''
  export let responseTime = null

  const labels = {
    idle: 'Not connected',
    loading: 'Connecting...',
    connected: 'Connected',
    error: 'Connection failed',
  }
</script>

<div class="glass-card p-5 flex flex-col gap-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <!-- Strapi logo mark -->
      <div class="w-9 h-9 rounded-xl flex items-center justify-center"
           style="background: linear-gradient(135deg, #4945ff, #7b79ff);">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="white">
          <path d="M20 4H8a4 4 0 0 0-4 4v12h4V8h12V4ZM24 12H12a4 4 0 0 0-4 4v12h4V16h12v-4ZM28 20H16v8h12a4 4 0 0 0 4-4v-4h-4Z"/>
        </svg>
      </div>
      <div>
        <div class="font-semibold text-sm" style="color: var(--text-primary)">Strapi GraphQL</div>
        {#if endpoint}
          <div class="text-xs font-mono mt-0.5" style="color: var(--text-muted)">{endpoint}</div>
        {/if}
      </div>
    </div>

    <!-- Status badge -->
    {#if status === 'loading'}
      <span class="status-badge loading">
        <span class="pulse-dot amber"></span>
        Connecting…
      </span>
    {:else if status === 'connected'}
      <span class="status-badge connected">
        <span class="pulse-dot green"></span>
        Connected
      </span>
    {:else if status === 'error'}
      <span class="status-badge error">
        <span class="pulse-dot red"></span>
        Failed
      </span>
    {:else}
      <span class="status-badge" style="background: var(--bg-secondary); color: var(--text-muted); border: 1px solid var(--border);">
        <span class="pulse-dot" style="background: var(--text-muted);"></span>
        Idle
      </span>
    {/if}
  </div>

  <!-- Metrics row -->
  {#if status === 'connected' && responseTime !== null}
    <div class="flex gap-4" style="border-top: 1px solid var(--border); padding-top: 14px;">
      <div class="flex flex-col gap-1">
        <span class="section-label">Response Time</span>
        <span class="text-sm font-semibold" style="color: var(--success)">{responseTime}ms</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="section-label">Protocol</span>
        <span class="text-sm font-semibold" style="color: var(--accent-light)">GraphQL</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="section-label">Status</span>
        <span class="text-sm font-semibold" style="color: var(--success)">200 OK</span>
      </div>
    </div>
  {/if}

  {#if status === 'error'}
    <div class="text-xs rounded-lg px-3 py-2"
         style="background: rgba(239,68,68,0.08); color: var(--error); border: 1px solid rgba(239,68,68,0.2);">
      ⚠ Could not reach Strapi. Make sure it's running on the URL above.
    </div>
  {/if}
</div>
