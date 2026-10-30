<script>
  // Word-to-Strapi Import Page
  // Communicates with word-to-strapi-service (http://localhost:3001)
  // The X-Import-Key is a dev-local key only; no Strapi token ever reaches the frontend

  const SERVICE_URL = 'http://localhost:3001';
  const IMPORT_API_KEY = 'dev_local_key_123'; // matches backend .env IMPORT_API_KEY

  export let connectionStatus = 'idle';
  export let connectionOrigin = '';
  export let connectionVersion = 0;

  // Main step state
  let step = 'upload'; // upload | previewing | confirmed | error
  let file = null;
  let isDragOver = false;
  let isLoading = false;
  let errorMsg = '';

  // Collections
  let collections = [];
  let selectedCollectionId = '';
  let collectionSearch = '';
  let collectionLoadState = 'loading';
  let lastConnectionVersion = connectionVersion;
  let isDynamicCollections = false;
  let collectionsRefreshedAt = null;

  // Preview data
  let importId = '';
  let preview = null;

  // Image assignment state
  // Map of fieldName -> imageIndex (user-assigned or auto-detected)
  let imageAssignments = {};
  let skipUnassignedImages = false;

  // Result data
  let result = null;

  // ── Reactive ───────────────────────────────────────────────────────────────
  $: availableCollections = collections.filter((collection) =>
    `${collection.displayName} ${collection.uid} ${collection.apiName}`.toLowerCase().includes(collectionSearch.toLowerCase())
  );
  $: selectedCollection = collections.find((collection) => collection.uid === selectedCollectionId);
  $: unassignedImageIndexes = (preview?.images ?? [])
    .filter((image) => !Object.values(imageAssignments).flat().includes(image.index))
    .map((image) => image.index);
  $: if (connectionVersion !== lastConnectionVersion) {
    lastConnectionVersion = connectionVersion;
    handleConnectionChange();
  }

  // Detect ambiguous images when preview arrives
  $: if (preview && preview.images && preview.images.length > 0) {
    computeImageAssignments(preview);
  }

  // ── Connection change ──────────────────────────────────────────────────────
  async function handleConnectionChange() {
    selectedCollectionId = '';
    file = null;
    preview = null;
    result = null;
    importId = '';
    step = 'upload';
    errorMsg = '';
    if (connectionStatus === 'connected') {
      await refreshAllCollections();
    } else {
      collections = [];
      collectionLoadState = 'unavailable';
    }
  }

  // ── Collections ────────────────────────────────────────────────────────────
  async function refreshCollections() {
    selectedCollectionId = '';
    if (connectionStatus !== 'connected' || !connectionOrigin) {
      collections = [];
      collectionLoadState = 'unavailable';
      return;
    }

    collectionLoadState = 'loading';
    errorMsg = '';
    try {
      const params = new URLSearchParams({ connectionOrigin });
      const response = await fetch(`${SERVICE_URL}/api/import/collections?${params}`, {
        headers: { 'X-Import-Key': IMPORT_API_KEY },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? `Server error ${response.status}`);
      collections = json.collections ?? [];
      collectionLoadState = 'loaded';
    } catch (error) {
      collections = [];
      collectionLoadState = 'error';
      errorMsg = error instanceof Error
        ? error.message
        : `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
    }
  }

  async function refreshAllCollections() {
    if (connectionStatus !== 'connected' || !connectionOrigin) {
      collections = [];
      selectedCollectionId = '';
      collectionLoadState = 'unavailable';
      return;
    }

    collectionLoadState = 'loading';
    errorMsg = '';
    try {
      const response = await fetch(`${SERVICE_URL}/api/import/collections/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Import-Key': IMPORT_API_KEY,
        },
        body: JSON.stringify({ connectionOrigin }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? `Server error ${response.status}`);
      collections = json.collections ?? [];
      if (!collections.some((collection) => collection.uid === selectedCollectionId)) {
        selectedCollectionId = '';
      }
      isDynamicCollections = json.dynamic ?? false;
      collectionsRefreshedAt = json.refreshedAt ?? null;
      collectionLoadState = 'loaded';
      if (json.warning) errorMsg = json.warning;
    } catch (error) {
      collectionLoadState = 'error';
      errorMsg = error instanceof Error
        ? error.message
        : `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
      // Fall back to static list
      await refreshCollections();
    }
  }

  // ── File handling ──────────────────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault();
    isDragOver = false;
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) setFile(dropped);
  }

  function handleFileInput(e) {
    const picked = e.target?.files?.[0];
    if (picked) setFile(picked);
  }

  function setFile(f) {
    if (!f.name.endsWith('.docx')) {
      errorMsg = 'Only .docx files are supported.';
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      errorMsg = 'File is too large. Max size is 10 MB.';
      return;
    }
    file = f;
    errorMsg = '';
  }

  // ── Image assignment ───────────────────────────────────────────────────────
  function computeImageAssignments(previewData) {
    imageAssignments = {};

    if (!previewData.images || previewData.images.length === 0) return;

    for (const field of getMediaFields()) {
      const state = field.sourceField
        ? previewData.debug?.fieldStates?.[field.sourceField]
        : previewData.debug?.fieldStates?.[field.name];
      if (state?.imageIndex !== undefined) {
        imageAssignments[field.name] = state.imageIndex;
      }
    }
  }

  function assignImageToField(fieldName, target) {
    const field = selectedCollection?.fields.find((candidate) => candidate.name === fieldName);
    if (field?.multiple) {
      const indices = Array.from(target.selectedOptions)
        .map((option) => Number(option.value))
        .filter(Number.isInteger);
      imageAssignments = indices.length
        ? { ...imageAssignments, [fieldName]: indices }
        : Object.fromEntries(Object.entries(imageAssignments).filter(([name]) => name !== fieldName));
    } else if (target.value === '') {
      const updated = { ...imageAssignments };
      delete updated[fieldName];
      imageAssignments = updated;
    } else {
      imageAssignments = { ...imageAssignments, [fieldName]: Number(target.value) };
    }
  }

  function imageAssigned(fieldName, imageIndex) {
    const assignment = imageAssignments[fieldName];
    return Array.isArray(assignment)
      ? assignment.includes(imageIndex)
      : assignment === imageIndex;
  }

  function getMediaFields() {
    if (!selectedCollection) return [];
    return selectedCollection.fields.filter((f) => f.type === 'media' && f.supported);
  }

  // ── Import preview ─────────────────────────────────────────────────────────
  async function uploadAndPreview() {
    if (!file || !selectedCollectionId || !connectionOrigin) return;
    isLoading = true;
    errorMsg = '';

    try {
      const form = new FormData();
      form.append('collectionId', selectedCollectionId);
      form.append('connectionOrigin', connectionOrigin);
      form.append('file', file);

      const res = await fetch(`${SERVICE_URL}/api/import/preview`, {
        method: 'POST',
        headers: { 'X-Import-Key': IMPORT_API_KEY },
        body: form,
      });

      const json = await res.json();

      if (!res.ok) {
        errorMsg = json.error ?? `Server error ${res.status}`;
        if (json.validationErrors) {
          errorMsg += ': ' + json.validationErrors.map(e => e.message).join(', ');
        }
        return;
      }

      importId = json.importId;
      preview = json.preview;
      imageAssignments = {};
      skipUnassignedImages = false;
      step = 'previewing';
    } catch (e) {
      errorMsg = `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
    } finally {
      isLoading = false;
    }
  }

  // ── Import confirm ─────────────────────────────────────────────────────────
  async function confirmImport() {
    isLoading = true;
    errorMsg = '';

    try {
      const res = await fetch(`${SERVICE_URL}/api/import/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Import-Key': IMPORT_API_KEY,
        },
        body: JSON.stringify({ importId, imageAssignments, skipUnassignedImages }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          errorMsg = `Duplicate: ${json.error} (documentId: ${json.documentId})`;
        } else {
          errorMsg = json.error ?? `Server error ${res.status}`;
          if (json.mediaUploadFailed && json.documentId) {
            errorMsg += ` A draft was created (${json.documentId}) but the image upload failed; review it before retrying.`;
          }
          if (json.hint) errorMsg += ` — ${json.hint}`;
        }
        return;
      }

      result = json;
      step = 'confirmed';
    } catch (e) {
      errorMsg = `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
    } finally {
      isLoading = false;
    }
  }

  function cancel() {
    file = null;
    preview = null;
    importId = '';
    result = null;
    imageAssignments = {};
    skipUnassignedImages = false;
    step = 'upload';
    errorMsg = '';
  }

  // ── Display helpers ────────────────────────────────────────────────────────
  function previewRows(payload) {
    const rows = [];
    const visit = (value, field) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
          value.forEach((item, index) => visit(item, `${field} #${index + 1}`));
        } else {
          rows.push({ field, value: value.map(String).join(', ') });
        }
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([name, child]) =>
          visit(child, field ? `${field}.${name}` : name)
        );
        return;
      }
      rows.push({ field, value: String(value) });
    };
    Object.entries(payload ?? {}).forEach(([field, value]) => visit(value, field));
    return rows;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  $: if (
    connectionStatus === 'connected' &&
    ['loading', 'unavailable'].includes(collectionLoadState) &&
    !collections.length
  ) {
    refreshCollections();
  }
</script>

<div class="import-page">
  <!-- Header -->
  <div class="import-header">
    <div class="import-logo">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    </div>
    <div>
      <h2>Word → Strapi Import</h2>
      <p>Choose a supported collection, then review and import your Word document as a draft</p>
    </div>

  </div>

  <!-- Error banner -->
  {#if errorMsg}
    <div class="import-error" role="alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {errorMsg}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════ STEP 1: Upload -->
  {#if step === 'upload'}
    <!-- Collection selector -->
    <section class="collection-card" aria-labelledby="collection-title">
      <div class="collection-heading">
        <div>
          <h3 id="collection-title">Select Target Collection</h3>
          <p>
            {isDynamicCollections ? '✓ Live collections from Strapi' : 'Static registry'}
            {collectionsRefreshedAt ? ` · Refreshed ${new Date(collectionsRefreshedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          type="button"
          class="btn-ghost"
          on:click={refreshAllCollections}
          disabled={collectionLoadState === 'loading' || connectionStatus !== 'connected'}
        >
          {#if collectionLoadState === 'loading'}
            <span class="spinner-sm" style="display:inline-block;margin-right:4px;"></span>Refreshing…
          {:else}
            🔄 Refresh Collections
          {/if}
        </button>
      </div>

      {#if connectionStatus !== 'connected'}
        <div class="collection-message">
          Connect to Strapi with the GraphQL Explorer before selecting a collection.
        </div>
      {:else if collectionLoadState === 'loading'}
        <div class="collection-message">Loading supported collections…</div>
      {:else if collectionLoadState === 'error'}
        <div class="collection-message collection-error">Collections could not be loaded. Check the import service and connection configuration.</div>
      {:else if availableCollections.length === 0}
        <div class="collection-message">
          No import-ready collection is available. Check the Strapi connection, then refresh the collection list.
        </div>
      {:else}
        <label class="section-label" for="collection-search">Search collections</label>
        <input
          id="collection-search"
          class="collection-control"
          type="search"
          bind:value={collectionSearch}
          placeholder="Search by name or API identifier"
        />
        <label class="section-label" for="collection-select">Available collection</label>
        <select
          id="collection-select"
          class="collection-control"
          bind:value={selectedCollectionId}
          disabled={isLoading}
        >
          <option value="">Choose a collection…</option>
          {#each availableCollections as collection}
            <option value={collection.uid}>
              {collection.displayName} — {collection.apiName}
              {collection.kind === 'singleType' ? ' [Single Type]' : ' [Collection Type]'}
            </option>
          {/each}
        </select>
        {#if selectedCollection}
          <div class="selected-collection">
            Selected: <strong>{selectedCollection.displayName}</strong>
            <code>{selectedCollection.uid}</code>
            <span>{selectedCollection.fields.filter((field) => field.supported).length} supported fields</span>
            {#if selectedCollection.dynamic}
              <span class="badge-dynamic">Live</span>
            {/if}
          </div>
        {/if}
      {/if}
      <small class="collection-note">Strapi validates create permissions when the import is submitted; a visible collection is not a permission grant.</small>
    </section>

    <!-- Drop zone -->
    <div
      class="drop-zone"
      class:drag-over={isDragOver}
      on:dragover|preventDefault={() => isDragOver = true}
      on:dragleave={() => isDragOver = false}
      on:drop={handleDrop}
      role="button"
      tabindex="0"
    >
      {#if file}
        <div class="file-selected">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div class="file-name">{file.name}</div>
          <div class="file-size">{(file.size / 1024).toFixed(1)} KB</div>
          <button class="btn-ghost" on:click={() => file = null}>Remove</button>
        </div>
      {:else}
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
          <polyline points="16 16 12 12 8 16"/>
          <line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
        </svg>
        <p class="drop-label">Drag &amp; drop your <strong>.docx</strong> here</p>
        <p class="drop-sub">or</p>
        <label class="btn-outline" for="file-input">Browse file</label>
        <input id="file-input" type="file" accept=".docx" on:change={handleFileInput} style="display:none" />
      {/if}
    </div>

    <button
      class="btn-primary"
      disabled={!file || !selectedCollection || isLoading}
      on:click={uploadAndPreview}
    >
      {#if isLoading}
        <span class="spinner-sm"></span> Extracting &amp; mapping…
      {:else}
        Analyse for {selectedCollection?.displayName ?? 'Selected Collection'} →
      {/if}
    </button>
  {/if}

  <!-- ═══════════════════════════════════════════════════════ STEP 2: Preview -->
  {#if step === 'previewing' && preview}
    <div class="preview-card">
      <div class="preview-header">
        <span class="section-label">Import Preview — {preview.collection?.displayName}</span>
      </div>

      <!-- Extracted Images Panel -->
      {#if preview.images?.length > 0 && getMediaFields().length > 0}
        <div class="images-panel">
          <h3 class="preview-subtitle">
            🖼 Extracted Images ({preview.images.length})
          </h3>
          <div class="images-grid">
            {#each preview.images as img}
              <div class="image-card">
                {#if img.preview}
                  <img src={img.preview} alt={img.altText || img.filename} class="image-thumb" />
                {:else}
                  <div class="image-placeholder">🖼</div>
                {/if}
                <div class="image-info">
                  <div class="image-filename">{img.filename}</div>
                  <div class="image-meta">{img.contentType} · {formatBytes(img.sizeBytes)}</div>
                  {#if img.altText && img.altText !== `Image ${img.index + 1}`}
                    <div class="image-alt">Alt: {img.altText}</div>
                  {/if}
                  {#if img.location}<div class="image-meta">{img.location}</div>{/if}
                  {#if img.caption}<div class="image-meta">Caption: {img.caption}</div>{/if}
                </div>
              </div>
            {/each}
          </div>

          <!-- Image-to-field assignment -->
          {#if getMediaFields().length > 0}
            <div class="image-assignment">
              <div class="section-label" style="margin-bottom:6px;">Assign images to media fields</div>
              {#each getMediaFields() as field}
                <div class="assignment-row">
                  <label for="assign-{field.name}" class="assignment-label">{field.name}</label>
                  <select
                    id="assign-{field.name}"
                    class="collection-control"
                    style="min-height:36px; padding:6px 10px;"
                    multiple={field.multiple}
                    value={field.multiple
                      ? (Array.isArray(imageAssignments[field.name]) ? imageAssignments[field.name].map(String) : [])
                      : (imageAssignments[field.name] !== undefined ? String(imageAssignments[field.name]) : '')}
                    on:change={(e) => assignImageToField(field.name, e.target)}
                  >
                    {#if !field.multiple}<option value="">— Skip / no image —</option>{/if}
                    {#each preview.images as img}
                      <option value={String(img.index)}>
                        {img.filename} — {img.location} ({formatBytes(img.sizeBytes)})
                        {imageAssigned(field.name, img.index) ? ' ✓ assigned' : ''}
                      </option>
                    {/each}
                  </select>
                </div>
              {/each}
            </div>
          {/if}
          {#if unassignedImageIndexes.length > 0}
            <label class="image-skip-row">
              <input type="checkbox" bind:checked={skipUnassignedImages} />
              Explicitly skip unassigned embedded images ({unassignedImageIndexes.join(', ')})
            </label>
          {/if}
        </div>
      {/if}

      <div>
        <h3 class="preview-subtitle">Document</h3>
        <p class="collection-note">{preview.documentName}</p>
        <h3 class="preview-subtitle">Fields to import</h3>
      </div>
      <div class="field-grid">
        {#each previewRows(preview.payload) as row}
          <div class="field-row">
            <div class="field-key">{row.field}</div>
            <div class="field-val">{row.value}</div>
          </div>
        {/each}
      </div>

      {#if previewRows(preview.payload).length === 0}
        <p class="collection-note">No document values match this collection's optional fields. You can still import an empty entry if Strapi permits it.</p>
      {/if}

      <!-- Stats -->
      <div class="stats-row">
        {#if Object.keys(imageAssignments).length > 0}
          <span style="color:#22c55e;">📎 {Object.keys(imageAssignments).length} image assignment{Object.keys(imageAssignments).length !== 1 ? 's' : ''}</span>
        {/if}
        {#if preview.duplicateDocumentId}
          <span class="warn-badge">⚠ Duplicate found (documentId: {preview.duplicateDocumentId})</span>
        {/if}
      </div>

      <details class="debug-panel">
        <summary>Technical diagnostics</summary>
        <pre>{JSON.stringify(preview.debug, null, 2)}</pre>
        <pre>{JSON.stringify(preview.payload, null, 2)}</pre>
      </details>

      <div class="action-row">
        <button class="btn-ghost" on:click={cancel} disabled={isLoading}>✕ Cancel</button>
        <button class="btn-primary" on:click={confirmImport} disabled={isLoading}>
          {#if isLoading}
            <span class="spinner-sm"></span> Creating draft…
          {:else}
            ✓ Import to {preview.collection?.displayName}
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- ══════════════════════════════════════════════════════ STEP 3: Confirmed -->
  {#if step === 'confirmed' && result}
    <div class="success-card">
      <div class="success-icon">✓</div>
      <h3>{result.collection?.displayName ?? 'Collection'} Draft Created!</h3>
      <div class="result-grid">
        <div class="result-row">
          <span class="result-label">Collection</span>
          <code class="result-val">{result.collection?.uid}</code>
        </div>
        <div class="result-row">
          <span class="result-label">documentId</span>
          <code class="result-val">{result.documentId}</code>
        </div>
        <div class="result-row">
          <span class="result-label">Media uploads</span>
          <code class="result-val">
            {#if result.uploadedMedia && Object.keys(result.uploadedMedia).length > 0}
              {Object.entries(result.uploadedMedia).map(([k,v]) => `${k}: ID ${v}`).join(', ')}
            {:else}
              None / skipped
            {/if}
          </code>
        </div>
        <div class="result-row">
          <span class="result-label">Verification</span>
          <code class="result-val" style="color:{result.verification.ok ? '#22c55e' : '#f59e0b'}">
            {result.verification.ok ? '✓ Saved data matches approved payload' : `⚠ ${result.verification.mismatches.length} mismatch(es)`}
          </code>
        </div>
      </div>

      {#if !result.verification.ok}
        <div class="warning-block">
          <strong>Mismatches:</strong>
          <ul>{#each result.verification.mismatches as m}<li>{m}</li>{/each}</ul>
        </div>
      {/if}

      <div class="action-row">
        <a href={result.adminLink} target="_blank" class="btn-outline">Open in Strapi Admin →</a>
        <button class="btn-ghost" on:click={cancel}>Import Another</button>
      </div>
    </div>
  {/if}

</div>

<style>
  .collection-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--bg-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 14px;
  }

  .collection-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .collection-heading h3 {
    margin: 0;
    color: var(--text-primary, #f1f1f5);
    font-size: 0.95rem;
  }

  .collection-heading p, .collection-note {
    margin: 4px 0 0;
    color: var(--text-muted, #6b7280);
    font-size: 0.76rem;
  }

  .collection-control {
    width: 100%;
    min-height: 42px;
    padding: 10px 12px;
    color: var(--text-primary, #f1f1f5);
    background: rgba(15, 15, 24, 0.8);
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 9px;
    outline: none;
    box-sizing: border-box;
  }

  .collection-control:focus {
    border-color: #7c70f5;
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
  }

  .collection-message {
    padding: 12px;
    color: var(--text-secondary, #a1a1aa);
    background: rgba(255,255,255,0.025);
    border-radius: 8px;
    font-size: 0.82rem;
  }

  .collection-error { color: #f87171; }

  .selected-collection {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary, #a1a1aa);
    font-size: 0.8rem;
  }

  .selected-collection strong { color: #a78bfa; }
  .selected-collection code {
    padding: 3px 6px;
    color: #c4b5fd;
    background: rgba(99, 102, 241, 0.1);
    border-radius: 5px;
  }

  .badge-dynamic {
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 999px;
    background: rgba(34,197,94,0.15);
    color: #4ade80;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .import-page {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .import-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border, #2a2a3a);
    flex-wrap: wrap;
  }

  .import-logo {
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: white;
  }

  .import-header h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary, #f1f1f5);
  }

  .import-header p {
    margin: 2px 0 0;
    font-size: 0.78rem;
    color: var(--text-muted, #6b7280);
  }

  .import-error {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 0.82rem;
    color: #f87171;
  }

  .drop-zone {
    border: 2px dashed var(--border, #2a2a3a);
    border-radius: 16px;
    padding: 48px 24px;
    text-align: center;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: var(--bg-card, rgba(255,255,255,0.02));
    transition: border-color 0.2s, background 0.2s;
  }

  .drop-zone.drag-over {
    border-color: #6366f1;
    background: rgba(99, 102, 241, 0.06);
  }

  .drop-label { margin: 0; font-size: 0.95rem; color: var(--text-secondary, #a1a1aa); }
  .drop-sub { margin: 0; font-size: 0.8rem; color: var(--text-muted, #6b7280); }

  .file-selected {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .file-name { font-weight: 600; font-size: 0.9rem; color: var(--text-primary, #f1f1f5); }
  .file-size { font-size: 0.78rem; color: var(--text-muted, #6b7280); }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    border-radius: 10px;
    padding: 12px 24px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.1s;
    width: 100%;
  }

  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary:not(:disabled):hover { opacity: 0.9; transform: translateY(-1px); }

  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 0.85rem;
    color: var(--text-secondary, #a1a1aa);
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-ghost:hover { background: rgba(255,255,255,0.04); }
  .btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }

  .btn-outline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    background: transparent;
    border: 1px solid #6366f1;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 0.85rem;
    color: #818cf8;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-outline:hover { background: rgba(99, 102, 241, 0.08); }

  .spinner-sm {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Preview card */
  .preview-card, .success-card {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    background: var(--bg-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 16px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted, #6b7280);
  }

  .preview-subtitle {
    margin: 4px 0 -8px;
    font-size: 0.9rem;
    color: var(--text-primary, #f1f1f5);
  }

  .field-grid { display: flex; flex-direction: column; gap: 8px; }

  .field-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    font-size: 0.82rem;
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
    border-radius: 8px;
    border: 1px solid var(--border, #2a2a3a);
  }

  .field-key { font-weight: 600; color: #818cf8; font-family: monospace; word-break: break-all; }
  .field-val {
    color: var(--text-secondary, #a1a1aa);
    word-break: break-word;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  /* Image panel */
  .images-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 12px;
  }

  .images-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .image-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 10px;
    max-width: 140px;
    word-break: break-word;
  }

  .image-thumb {
    width: 100px;
    height: 80px;
    object-fit: cover;
    border-radius: 6px;
    background: rgba(0,0,0,0.2);
  }

  .image-placeholder {
    width: 100px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    background: rgba(99, 102, 241, 0.08);
    border-radius: 6px;
  }

  .image-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
  }

  .image-filename { font-size: 0.72rem; font-weight: 600; color: var(--text-secondary, #a1a1aa); }
  .image-meta { font-size: 0.67rem; color: var(--text-muted, #6b7280); }
  .image-alt { font-size: 0.67rem; color: #818cf8; }

  .image-assignment {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border, #2a2a3a);
  }

  .assignment-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .assignment-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: #818cf8;
    font-family: monospace;
    min-width: 120px;
    flex-shrink: 0;
  }

  .image-skip-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--text-muted, #a1a1aa);
    font-size: 0.76rem;
  }

  .stats-row {
    display: flex;
    gap: 16px;
    font-size: 0.8rem;
    color: var(--text-muted, #6b7280);
    flex-wrap: wrap;
  }

  .warn-badge {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 6px;
    padding: 2px 8px;
    color: #f59e0b;
  }

  .warning-block {
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.25);
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 0.8rem;
    color: #fbbf24;
  }

  .warning-block ul {
    margin: 6px 0 0;
    padding-left: 18px;
  }

  .action-row {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  /* Success card */
  .success-icon {
    width: 52px; height: 52px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.12);
    border: 2px solid rgba(34, 197, 94, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    color: #22c55e;
    margin: 0 auto;
  }

  .success-card h3 {
    text-align: center;
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary, #f1f1f5);
  }

  .result-grid { display: flex; flex-direction: column; gap: 8px; }

  .result-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 12px;
    font-size: 0.82rem;
  }

  .result-label { color: var(--text-muted, #6b7280); font-weight: 600; }
  .result-val { font-family: monospace; color: var(--text-secondary, #a1a1aa); word-break: break-all; }

</style>
