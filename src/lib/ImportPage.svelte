<script>
  // Word-to-Strapi Import Page
  // Communicates with word-to-strapi-service (http://localhost:3001)
  // The X-Import-Key is a dev-local key only; no Strapi token ever reaches the frontend

  const SERVICE_URL = 'http://localhost:3001';
  const IMPORT_API_KEY = 'dev_local_key_123'; // matches backend .env IMPORT_API_KEY

  let step = 'upload'; // upload | previewing | confirmed | error
  let file = null;
  let isDragOver = false;
  let isLoading = false;
  let errorMsg = '';

  // Preview data
  let importId = '';
  let preview = null;

  // Result data
  let result = null;

  // --- File handling ---
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

  // --- Phase 6: /api/import/preview ---
  async function uploadAndPreview() {
    if (!file) return;
    isLoading = true;
    errorMsg = '';

    try {
      const form = new FormData();
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
      step = 'previewing';
    } catch (e) {
      errorMsg = `Cannot reach import service at ${SERVICE_URL}. Is it running?`;
    } finally {
      isLoading = false;
    }
  }

  // --- Phase 6: /api/import/confirm ---
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
        body: JSON.stringify({ importId }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          errorMsg = `Duplicate: ${json.error} (documentId: ${json.documentId})`;
        } else {
          errorMsg = json.error ?? `Server error ${res.status}`;
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
    step = 'upload';
    errorMsg = '';
  }

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
      <p>Upload a .docx file to create a draft Article in Strapi</p>
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

  <!-- STEP 1: Upload -->
  {#if step === 'upload'}
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
        <p class="drop-label">Drag & drop your <strong>.docx</strong> here</p>
        <p class="drop-sub">or</p>
        <label class="btn-outline" for="file-input">Browse file</label>
        <input id="file-input" type="file" accept=".docx" on:change={handleFileInput} style="display:none" />
      {/if}
    </div>

    <button
      class="btn-primary"
      disabled={!file || isLoading}
      on:click={uploadAndPreview}
    >
      {#if isLoading}
        <span class="spinner-sm"></span> Extracting & mapping…
      {:else}
        Analyse Document →
      {/if}
    </button>
  {/if}

  <!-- STEP 2: Preview -->
  {#if step === 'previewing' && preview}
    <div class="preview-card">
      <div class="preview-header">
        <span class="section-label">Document Extraction Preview</span>
        <span class="confidence-badge" style="color:{confidenceColor(preview.confidence)}">
          ● {preview.confidence} confidence
        </span>
      </div>

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

      <h3 class="preview-subtitle">Ready for Strapi draft</h3>
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
        <button class="btn-primary" on:click={confirmImport} disabled={isLoading}>
          {#if isLoading}
            <span class="spinner-sm"></span> Creating draft…
          {:else}
            ✓ Approve & Create Draft
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- STEP 3: Confirmed -->
  {#if step === 'confirmed' && result}
    <div class="success-card">
      <div class="success-icon">✓</div>
      <h3>Draft Created!</h3>
      <div class="result-grid">
        <div class="result-row">
          <span class="result-label">documentId</span>
          <code class="result-val">{result.documentId}</code>
        </div>
        <div class="result-row">
          <span class="result-label">Cover image</span>
          <code class="result-val">{result.uploadedImageId ? `Media ID: ${result.uploadedImageId}` : 'None / skipped'}</code>
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
  .import-page {
    max-width: 680px;
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
    grid-template-columns: 120px 1fr;
    gap: 12px;
    font-size: 0.82rem;
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
    border-radius: 8px;
    border: 1px solid var(--border, #2a2a3a);
  }

  .field-key { font-weight: 600; color: #818cf8; font-family: monospace; }
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
</style>
