<script>
  // Word-to-Strapi Import Page
  // Communicates with word-to-strapi-service (http://localhost:3001)
  // The X-Import-Key is a dev-local key only; no Strapi token ever reaches the frontend

  const SERVICE_URL = 'http://localhost:3001';
  const IMPORT_API_KEY = 'dev_local_key_123'; // matches backend .env IMPORT_API_KEY

  export let connectionStatus = 'idle';
  export let connectionOrigin = '';
  export let connectionVersion = 0;
  export let reconnect = () => {};

  // Main step state
  let step = 'upload'; // upload | previewing | confirmed | error | schema_analysis | schema_review | schema_creating
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
  let schemaFieldApprovals = {};

  // Image assignment state
  // Map of fieldName -> imageIndex (user-assigned or auto-detected)
  let imageAssignments = {};
  // Ambiguous images (multiple images, no auto-detection)
  let ambiguousImages = [];
  let skipMissingSchemaFields = false;
  let skipConflictingSchemaFields = false;
  let skipUnsupportedSchemaFields = false;
  let skipUnassignedImages = false;

  // Result data
  let result = null;

  // Admin JWT status
  let adminStatus = null;
  let adminStatusLoaded = false;

  // Schema analysis
  let schemaFile = null;
  let schemaAnalysis = null;
  let schemaProposed = null;
  let schemaEditMode = false;
  let schemaKind = 'collectionType';
  let schemaDisplayName = '';
  let schemaIncludeUncertain = false;

  // ── Reactive ───────────────────────────────────────────────────────────────
  $: availableCollections = collections.filter((collection) =>
    `${collection.displayName} ${collection.uid} ${collection.apiName}`.toLowerCase().includes(collectionSearch.toLowerCase())
  );
  $: selectedCollection = collections.find((collection) => collection.uid === selectedCollectionId);
  $: unassignedImageIndexes = (preview?.images ?? [])
    .filter((image) => !Object.values(imageAssignments).flat().includes(image.index))
    .map((image) => image.index);
  $: schemaReviewRequired = Boolean(
    preview?.schemaDiff &&
    ((preview.schemaDiff.missingFields.length && !skipMissingSchemaFields) ||
      (preview.schemaDiff.conflictingFields.length && !skipConflictingSchemaFields) ||
      (preview.schemaDiff.unsupportedFields.length && !skipUnsupportedSchemaFields))
  ) || (unassignedImageIndexes.length > 0 && !skipUnassignedImages);
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
      await loadAdminStatus();
    } else {
      collections = [];
      collectionLoadState = 'unavailable';
    }
  }

  async function loadAdminStatus() {
    try {
      const res = await fetch(`${SERVICE_URL}/api/schema/admin-status`, {
        headers: { 'X-Import-Key': IMPORT_API_KEY },
      });
      if (res.ok) {
        adminStatus = await res.json();
      }
    } catch {
      adminStatus = null;
    }
    adminStatusLoaded = true;
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
    ambiguousImages = [];

    if (!previewData.images || previewData.images.length === 0) return;

    for (const field of getMediaFields()) {
      const state = field.sourceField
        ? previewData.fieldStates?.[field.sourceField]
        : previewData.fieldStates?.[field.name];
      if (state?.imageIndex !== undefined) {
        imageAssignments[field.name] = state.imageIndex;
      }
    }

    if (Object.keys(imageAssignments).length < previewData.images.length) {
      ambiguousImages = previewData.images;
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
      schemaFieldApprovals = Object.fromEntries(
        (json.preview.schemaDiff?.missingFields ?? []).map((field) => [field.name, true])
      );
      imageAssignments = {};
      ambiguousImages = [];
      skipMissingSchemaFields = false;
      skipConflictingSchemaFields = false;
      skipUnsupportedSchemaFields = false;
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

  async function applyApprovedSchemaChanges() {
    const approvedFields = Object.entries(schemaFieldApprovals)
      .filter(([, approved]) => approved)
      .map(([name]) => name);
    if (!importId || approvedFields.length === 0) return;

    isLoading = true;
    errorMsg = '';
    try {
      const response = await fetch(`${SERVICE_URL}/api/schema/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Import-Key': IMPORT_API_KEY,
        },
        body: JSON.stringify({ importId, approvedFields, confirmed: true }),
      });
      const json = await response.json();
      if (!response.ok) {
        errorMsg = json.error ?? `Server error ${response.status}`;
        return;
      }
      if (!json.refreshed) {
        errorMsg = json.warning ?? 'Strapi accepted the schema update but could not verify the refreshed schema.';
        return;
      }

      const currentFile = file;
      await refreshAllCollections();
      if (!collections.some((collection) => collection.uid === selectedCollectionId)) {
        errorMsg = 'The schema changed, but the selected content type is not available after refresh.';
        return;
      }
      file = currentFile;
      await uploadAndPreview();
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : 'Schema update failed.';
    } finally {
      isLoading = false;
    }
  }

  function cancel() {
    file = null;
    preview = null;
    importId = '';
    schemaFieldApprovals = {};
    result = null;
    imageAssignments = {};
    ambiguousImages = [];
    skipUnassignedImages = false;
    step = 'upload';
    errorMsg = '';
  }

  // ── Schema analysis ────────────────────────────────────────────────────────
  function handleSchemaFileInput(e) {
    const picked = e.target?.files?.[0];
    if (picked) {
      if (!picked.name.endsWith('.docx')) {
        errorMsg = 'Only .docx files are supported.';
        return;
      }
      schemaFile = picked;
      errorMsg = '';
    }
  }

  async function analyzeSchema() {
    if (!schemaFile) return;
    isLoading = true;
    errorMsg = '';
    schemaAnalysis = null;
    schemaProposed = null;

    try {
      const form = new FormData();
      form.append('file', schemaFile);
      form.append('kind', schemaKind);
      if (schemaDisplayName.trim()) form.append('displayName', schemaDisplayName.trim());

      const res = await fetch(`${SERVICE_URL}/api/schema/analyze`, {
        method: 'POST',
        headers: { 'X-Import-Key': IMPORT_API_KEY },
        body: form,
      });

      const json = await res.json();

      if (!res.ok) {
        errorMsg = json.error ?? `Server error ${res.status}`;
        return;
      }

      schemaAnalysis = json;
      schemaProposed = json.proposed ? { ...json.proposed } : null;
      step = 'schema_review';
    } catch (e) {
      errorMsg = `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
    } finally {
      isLoading = false;
    }
  }

  async function createSchema() {
    if (!schemaProposed) return;
    isLoading = true;
    errorMsg = '';

    // Build the payload from proposed schema
    const attributes = {};
    for (const field of schemaProposed.fields) {
      if (field.uncertain && !schemaIncludeUncertain) continue;
      if (field.type === 'component' && !schemaIncludeUncertain) continue;
      attributes[field.name] = { ...field.attributes };
    }

    // Always add slug if title present and no slug
    if (attributes['title'] && !attributes['slug']) {
      attributes['slug'] = { type: 'uid', targetField: 'title' };
    }

    const payload = {
      kind: schemaProposed.kind,
      info: {
        displayName: schemaProposed.displayName,
        singularName: schemaProposed.singularName,
        pluralName: schemaProposed.pluralName,
      },
      options: { draftAndPublish: schemaProposed.draftAndPublish },
      attributes,
    };

    step = 'schema_creating';

    try {
      const res = await fetch(`${SERVICE_URL}/api/schema/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Import-Key': IMPORT_API_KEY,
        },
        body: JSON.stringify({ payload, confirmed: true }),
      });

      const json = await res.json();
      if (!res.ok) {
        errorMsg = json.error ?? `Server error ${res.status}`;
        if (json.hint) errorMsg += ` — ${json.hint}`;
        step = 'schema_review';
        return;
      }

      // Success — refresh collections and go back to upload
      await refreshAllCollections();
      // Reconnect GraphQL to pick up new schema
      await reconnect();
      step = 'upload';
      errorMsg = '';
      // Select the new collection if available
      const newCol = collections.find((c) => c.uid === json.uid);
      if (newCol) selectedCollectionId = newCol.uid;
    } catch (e) {
      errorMsg = `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
      step = 'schema_review';
    } finally {
      isLoading = false;
    }
  }

  // ── Display helpers ────────────────────────────────────────────────────────
  function confidenceColor(c) {
    return c === 'high' ? '#22c55e' : c === 'medium' ? '#f59e0b' : '#ef4444';
  }

  function getNestedValue(object, path) {
    return path.split('.').reduce((value, part) => value?.[part], object);
  }

  function fieldDisplayValue(key, state) {
    const value = getNestedValue(preview?.fields, key);
    if (value !== undefined && value !== null && value !== '') {
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    if (state.rawValue) return state.rawValue;
    if (state.status === 'explicitly_empty') return '(explicitly empty)';
    if (state.status === 'missing') return '(not present in document)';
    if (state.status === 'unresolved') return '(manual resolution needed)';
    if (state.status === 'invalid') return '(invalid value)';
    return '(no value)';
  }

  function payloadDisplayValue(value) {
    return typeof value === 'string' ? value : JSON.stringify(value);
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

    <!-- Schema Generator tab button -->
    <div style="margin-left: auto;">
      {#if step === 'upload'}
        <button class="btn-ghost" style="font-size:0.78rem;"
          on:click={() => { step = 'schema_analysis'; errorMsg = ''; }}>
          ✨ Generate Schema
        </button>
      {:else if ['schema_analysis','schema_review','schema_creating'].includes(step)}
        <button class="btn-ghost" style="font-size:0.78rem;" on:click={cancel}>
          ← Back to Import
        </button>
      {/if}
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
          No import-ready collection is available. Try Refresh Collections or use "Generate Schema" to create a new content type.
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
        <span class="confidence-badge" style="color:{confidenceColor(preview.confidence)}">
          ● {preview.confidence} confidence
        </span>
      </div>

      <!-- Extracted Images Panel -->
      {#if preview.images && preview.images.length > 0}
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
          {:else if preview.images.length > 0}
            <div class="info-block" style="margin-top:8px;">
              <strong>ℹ Images extracted but no supported media field found in this collection.</strong>
              Images will not be uploaded. Choose a collection that includes a media field, or use "Generate Schema" to create one.
            </div>
          {/if}
          {#if unassignedImageIndexes.length > 0}
            <label class="schema-skip-row">
              <input type="checkbox" bind:checked={skipUnassignedImages} />
              Explicitly skip unassigned embedded images ({unassignedImageIndexes.join(', ')})
            </label>
          {/if}
        </div>
      {/if}

      {#if preview.schemaDiff}
        <section class="schema-diff-panel" aria-label="Schema comparison">
          <h3 class="preview-subtitle">Document-to-schema comparison</h3>
          <p class="collection-note">
            Existing fields are preserved. Missing simple fields can be added only after explicit approval.
            Conflicts are never changed automatically.
          </p>

          {#if preview.schemaDiff.compatibleFields.length}
            <div class="schema-diff-group">
              <strong>Compatible fields ({preview.schemaDiff.compatibleFields.length})</strong>
              <ul>
                {#each preview.schemaDiff.compatibleFields as field}
                  <li>{field.documentField} → {field.schemaField} ({field.type})</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if preview.schemaDiff.missingFields.length}
            <div class="schema-diff-group">
              <strong>Missing fields ({preview.schemaDiff.missingFields.length})</strong>
              {#each preview.schemaDiff.missingFields as field}
                <label class="schema-approval-row">
                  <input type="checkbox" bind:checked={schemaFieldApprovals[field.name]} />
                  <code>{field.name}</code>
                  <span>{field.type}</span>
                  <small>{field.reason}</small>
                </label>
              {/each}
              {#if adminStatusLoaded && adminStatus?.valid}
                <button
                  type="button"
                  class="btn-outline"
                  disabled={isLoading || !Object.values(schemaFieldApprovals).some(Boolean)}
                  on:click={applyApprovedSchemaChanges}
                >
                  {isLoading ? 'Applying and verifying…' : 'Apply approved additions, refresh schema & re-analyze'}
                </button>
              {:else}
                <p class="collection-error">
                  Additive schema changes require authorized Content-Type Builder access in Strapi development mode.
                  Configure the server-side admin JWT or add these fields manually, then refresh and re-analyze.
                </p>
              {/if}
              <label class="schema-skip-row">
                <input type="checkbox" bind:checked={skipMissingSchemaFields} />
                Skip these new fields and import only values compatible with the current schema
              </label>
            </div>
          {/if}

          {#if preview.schemaDiff.conflictingFields.length}
            <div class="schema-diff-group schema-conflict">
              <strong>Type conflicts ({preview.schemaDiff.conflictingFields.length})</strong>
              <ul>
                {#each preview.schemaDiff.conflictingFields as field}
                  <li>{field.schemaField}: document suggests {field.proposedType}, existing type is {field.existingType}. No change was made.</li>
                {/each}
              </ul>
              <label class="schema-skip-row">
                <input type="checkbox" bind:checked={skipConflictingSchemaFields} />
                Skip conflicting fields and import only compatible values
              </label>
            </div>
          {/if}

          {#if preview.schemaDiff.unsupportedFields.length}
            <div class="schema-diff-group">
              <strong>Manual configuration required ({preview.schemaDiff.unsupportedFields.length})</strong>
              <ul>
                {#each preview.schemaDiff.unsupportedFields as field}
                  <li>{field.name} ({field.type}): {field.reason}</li>
                {/each}
              </ul>
              <label class="schema-skip-row">
                <input type="checkbox" bind:checked={skipUnsupportedSchemaFields} />
                Skip unsupported structures and import only compatible values
              </label>
            </div>
          {/if}
        </section>
      {/if}

      <h3 class="preview-subtitle">All recognized document fields</h3>
      <div class="field-grid">
        {#each Object.entries(preview.fieldStates ?? {}) as [key, state]}
          <div class="field-row">
            <div class="field-key">{key}</div>
            <div class="field-val">
              <span class={`state-badge state-${state.status}`}>{state.status.replaceAll('_', ' ')}</span>
              {#if state.uploadStatus}
                <span class={`state-badge upload-${state.uploadStatus}`}>upload: {state.uploadStatus.replaceAll('_', ' ')}</span>
              {/if}
              <span>{fieldDisplayValue(key, state)}</span>
              {#if state.reason}<small>{state.reason}</small>{/if}
            </div>
          </div>
        {/each}
      </div>

      <h3 class="preview-subtitle">Payload for {preview.collection?.apiName} draft</h3>
      <div class="field-grid">
        {#each Object.entries(preview.payload) as [key, val]}
          <div class="field-row">
            <div class="field-key">{key}</div>
            <div class="field-val">{payloadDisplayValue(val).substring(0, 300)}</div>
          </div>
        {/each}
      </div>

      <!-- Stats -->
      <div class="stats-row">
        <span>📄 {preview.wordCount} words</span>
        <span>🖼 {preview.imageCount} image{preview.imageCount !== 1 ? 's' : ''}</span>
        {#if Object.keys(imageAssignments).length > 0}
          <span style="color:#22c55e;">📎 {Object.keys(imageAssignments).length} image assignment{Object.keys(imageAssignments).length !== 1 ? 's' : ''}</span>
        {/if}
        {#if preview.duplicateDocumentId}
          <span class="warn-badge">⚠ Duplicate found (documentId: {preview.duplicateDocumentId})</span>
        {/if}
      </div>

      <!-- Missing fields -->
      {#if preview.missingFields.length > 0}
        <div class="warning-block">
          <strong>⚠ Missing fields:</strong>
          <ul>{#each preview.missingFields as f}<li>{f}</li>{/each}</ul>
        </div>
      {/if}

      <!-- Ambiguities -->
      {#if preview.ambiguities.length > 0}
        <div class="info-block">
          <strong>ℹ Ambiguities (review recommended):</strong>
          <ul>{#each preview.ambiguities as a}<li>{a}</li>{/each}</ul>
        </div>
      {/if}

      {#if preview.unmappedFields?.length > 0}
        <div class="info-block">
          <strong>Fields retained for manual mapping:</strong>
          <ul>
            {#each preview.unmappedFields as field}
              <li><strong>{field.label}:</strong> {field.value}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if preview.warnings?.length > 0}
        <div class="warning-block">
          <strong>Warnings:</strong>
          <ul>{#each preview.warnings as warning}<li>{warning}</li>{/each}</ul>
        </div>
      {/if}

      <div class="action-row">
        <button class="btn-ghost" on:click={cancel} disabled={isLoading}>✕ Cancel</button>
        <button class="btn-primary" on:click={confirmImport} disabled={isLoading || schemaReviewRequired}>
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

  <!-- ══════════════════════════════════════════ SCHEMA GENERATOR: Step 1 — Upload -->
  {#if step === 'schema_analysis'}
    <div class="preview-card">
      <div class="preview-header">
        <span class="section-label">✨ Generate Strapi Schema from Document</span>
      </div>

      <p style="font-size:0.83rem; color:var(--text-secondary,#a1a1aa); margin:0 0 4px;">
        Upload a Word document to infer a proposed Strapi content type schema.
        You will review all inferred fields before anything is created.
      </p>

      {#if adminStatusLoaded && adminStatus}
        <div class={adminStatus.valid ? 'info-block' : 'warning-block'} style="font-size:0.78rem;">
          {adminStatus.valid ? 'ℹ' : '⚠'} {adminStatus.message}
          {#if !adminStatus.configured}
            <br/><small>Add <code>STRAPI_ADMIN_JWT</code> to <code>word-to-strapi-service/.env</code> to enable schema creation.</small>
          {/if}
        </div>
      {/if}

      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:4px;">
        <label style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:180px;">
          <span class="section-label">Type</span>
          <select class="collection-control" bind:value={schemaKind} style="min-height:40px;">
            <option value="collectionType">Collection Type (multiple entries)</option>
            <option value="singleType">Single Type (one entry)</option>
          </select>
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; flex:2; min-width:220px;">
          <span class="section-label">Proposed Display Name (optional)</span>
          <input
            class="collection-control"
            type="text"
            bind:value={schemaDisplayName}
            placeholder="e.g. Blog Post, Landing Page…"
            style="min-height:40px;"
          />
        </label>
      </div>

      <label style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
        <span class="section-label">Select .docx file to analyze</span>
        <input type="file" accept=".docx" on:change={handleSchemaFileInput} style="color:var(--text-secondary,#a1a1aa); font-size:0.82rem;" />
      </label>

      {#if schemaFile}
        <div style="font-size:0.78rem; color:var(--text-muted,#6b7280);">
          Selected: {schemaFile.name} ({(schemaFile.size/1024).toFixed(1)} KB)
        </div>
      {/if}

      <div class="action-row" style="margin-top:8px;">
        <button class="btn-ghost" on:click={cancel}>Cancel</button>
        <button class="btn-primary" disabled={!schemaFile || isLoading} on:click={analyzeSchema} style="flex:0 0 auto; width:auto; padding: 12px 24px;">
          {#if isLoading}
            <span class="spinner-sm"></span> Analyzing…
          {:else}
            Analyze Document →
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- ══════════════════════════════════════════ SCHEMA GENERATOR: Step 2 — Review -->
  {#if step === 'schema_review' && schemaProposed}
    <div class="preview-card">
      <div class="preview-header">
        <span class="section-label">✨ Proposed Schema — Review &amp; Edit</span>
        <span class="confidence-badge" style="color:{confidenceColor(schemaProposed.confidence)}">
          ● {schemaProposed.confidence} confidence
        </span>
      </div>

      <!-- Compatibility with existing schemas -->
      {#if schemaAnalysis?.compatibilityChecks?.length > 0}
        <div class="info-block" style="margin-bottom:0;">
          <strong>ℹ Compatible existing schemas found:</strong>
          <ul>
            {#each schemaAnalysis.compatibilityChecks as check}
              <li>
                <strong>{check.displayName}</strong> ({check.uid}) — {check.score}% match
                {check.compatible ? ' ✓ Compatible — consider reusing this instead of creating a new type.' : ''}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Content type info -->
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <label style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:180px;">
          <span class="section-label">Display Name</span>
          <input class="collection-control" type="text" bind:value={schemaProposed.displayName} style="min-height:36px;" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:140px;">
          <span class="section-label">Singular Name</span>
          <input class="collection-control" type="text" bind:value={schemaProposed.singularName} style="min-height:36px;" placeholder="e.g. blogpost" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:140px;">
          <span class="section-label">Plural Name</span>
          <input class="collection-control" type="text" bind:value={schemaProposed.pluralName} style="min-height:36px;" placeholder="e.g. blogposts" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; flex:0 0 auto;">
          <span class="section-label">Type</span>
          <select class="collection-control" bind:value={schemaProposed.kind} style="min-height:36px;">
            <option value="collectionType">Collection Type</option>
            <option value="singleType">Single Type</option>
          </select>
        </label>
      </div>

      <!-- Inferred fields -->
      <h3 class="preview-subtitle">Inferred Fields ({schemaProposed.fields.length})</h3>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:0.78rem; color:var(--text-muted,#6b7280);">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" bind:checked={schemaIncludeUncertain} />
          Include uncertain/complex fields (components, media, manually flagged)
        </label>
      </div>
      <div class="field-grid">
        {#each schemaProposed.fields as field, i}
          {#if !field.uncertain || schemaIncludeUncertain}
            <div class="field-row" style="flex-wrap:wrap; gap:6px;">
              <div class="field-key">
                <input
                  class="inline-edit"
                  type="text"
                  bind:value={field.name}
                  placeholder="field name"
                />
              </div>
              <div class="field-val" style="flex-direction:row; align-items:center; gap:8px; flex-wrap:wrap;">
                <select class="inline-select" bind:value={field.type}
                  on:change={() => { field.attributes = { ...field.attributes, type: field.type }; schemaProposed = { ...schemaProposed }; }}>
                  <option value="string">string</option>
                  <option value="text">text</option>
                  <option value="richtext">richtext</option>
                  <option value="uid">uid</option>
                  <option value="date">date</option>
                  <option value="datetime">datetime</option>
                  <option value="boolean">boolean</option>
                  <option value="integer">integer</option>
                  <option value="decimal">decimal</option>
                  <option value="email">email</option>
                  <option value="media">media</option>
                  <option value="component">component</option>
                </select>
                <span class={`state-badge state-${field.confidence === 'high' ? 'extracted' : field.confidence === 'medium' ? 'requires_review' : 'invalid'}`}>
                  {field.confidence} confidence
                </span>
                {#if field.uncertain}
                  <span class="state-badge state-unresolved">uncertain</span>
                {/if}
                <small style="color:var(--text-muted,#6b7280); flex:1 0 100%;">{field.reason}</small>
                {#if field.sourceValue}
                  <small style="color:var(--text-muted,#6b7280);">Sample: {String(field.sourceValue).substring(0, 80)}</small>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>

      <!-- Warnings -->
      {#if schemaProposed.warnings?.length > 0}
        <div class="warning-block">
          <strong>⚠ Warnings:</strong>
          <ul>{#each schemaProposed.warnings as w}<li>{w}</li>{/each}</ul>
        </div>
      {/if}

      <!-- Unrepresentable -->
      {#if schemaProposed.unrepresentable?.length > 0}
        <div class="info-block">
          <strong>ℹ Fields not automatically representable (require manual setup):</strong>
          <ul>{#each schemaProposed.unrepresentable as u}<li>{u}</li>{/each}</ul>
        </div>
      {/if}

      {#if !adminStatus?.valid}
        <div class="warning-block">
          <strong>⚠ Schema creation requires STRAPI_ADMIN_JWT.</strong>
          You can review the schema above and copy field definitions to Strapi manually, or configure the admin JWT to enable automated creation.
        </div>
      {/if}

      <div class="action-row">
        <button class="btn-ghost" on:click={() => { step = 'schema_analysis'; errorMsg = ''; }}>← Back</button>
        <button class="btn-ghost" on:click={cancel}>Cancel</button>
        <button
          class="btn-primary"
          disabled={!adminStatus?.valid || isLoading}
          on:click={createSchema}
          title={!adminStatus?.valid ? 'STRAPI_ADMIN_JWT required for schema creation' : ''}
          style="flex:0 0 auto; width:auto; padding: 12px 24px;"
        >
          {#if isLoading}
            <span class="spinner-sm"></span> Creating…
          {:else}
            ✓ Create "{schemaProposed.displayName}"
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════ SCHEMA GENERATOR: Creating -->
  {#if step === 'schema_creating'}
    <div class="preview-card" style="text-align:center; align-items:center;">
      <div class="spinner" style="width:40px;height:40px;margin:0 auto;"></div>
      <h3 style="color:var(--text-primary,#f1f1f5); margin:12px 0 4px;">Creating Content Type…</h3>
      <p style="color:var(--text-secondary,#a1a1aa); font-size:0.83rem; margin:0;">
        Strapi is writing the schema files and will restart automatically.
        This may take 15–30 seconds.
      </p>
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

  .spinner {
    border: 3px solid rgba(255,255,255,0.1);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Preview card */
  .preview-card, .success-card {
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

  .confidence-badge {
    font-size: 0.78rem;
    font-weight: 600;
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

  .field-val small { color: var(--text-muted, #6b7280); }

  .state-badge {
    font-size: 0.68rem;
    line-height: 1;
    text-transform: uppercase;
    border-radius: 999px;
    padding: 4px 7px;
    background: rgba(148, 163, 184, 0.12);
    color: #cbd5e1;
  }

  .state-extracted { color: #4ade80; background: rgba(34, 197, 94, 0.12); }
  .state-explicitly_empty { color: #94a3b8; }
  .state-unresolved, .state-requires_review { color: #fbbf24; background: rgba(245, 158, 11, 0.12); }
  .state-invalid { color: #f87171; background: rgba(239, 68, 68, 0.12); }
  .state-missing { color: #94a3b8; }
  .upload-ready { color: #4ade80; background: rgba(34, 197, 94, 0.12); }
  .upload-manual, .upload-unsupported, .upload-blocked { color: #fbbf24; background: rgba(245, 158, 11, 0.12); }
  .upload-not_ready { color: #94a3b8; }

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

  .schema-diff-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    background: rgba(99, 102, 241, 0.045);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 12px;
  }

  .schema-diff-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 8px;
    color: var(--text-secondary, #a1a1aa);
    font-size: 0.8rem;
  }

  .schema-diff-group ul { margin: 0; padding-left: 20px; }
  .schema-conflict { border-color: rgba(245, 158, 11, 0.35); }

  .schema-approval-row {
    display: grid;
    grid-template-columns: auto minmax(100px, 0.6fr) minmax(70px, 0.35fr) minmax(180px, 1fr);
    align-items: center;
    gap: 8px;
    padding: 6px 0;
  }

  .schema-approval-row code { color: #c4b5fd; }
  .schema-approval-row small { color: var(--text-muted, #6b7280); }

  .schema-skip-row {
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

  .info-block {
    background: rgba(99, 102, 241, 0.06);
    border: 1px solid rgba(99, 102, 241, 0.25);
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 0.8rem;
    color: #818cf8;
  }

  .warning-block ul, .info-block ul {
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

  /* Inline editing for schema review */
  .inline-edit {
    background: rgba(15,15,24,0.8);
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 5px;
    color: #818cf8;
    font-family: monospace;
    font-size: 0.82rem;
    padding: 4px 6px;
    width: 100%;
    box-sizing: border-box;
  }

  .inline-select {
    background: rgba(15,15,24,0.8);
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 5px;
    color: var(--text-secondary, #a1a1aa);
    font-size: 0.78rem;
    padding: 3px 6px;
    cursor: pointer;
  }
</style>
