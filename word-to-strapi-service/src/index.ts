import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { extractDocx } from './extract';
import { mapDocumentToCollection } from './mapper';
import {
  getImportableCollections,
  getImportCollection,
  validateConnectionOrigin,
  validateImportPayload,
  setDynamicCollectionsCache,
  clearDynamicCollectionsCache,
} from './collections';
import type { AiMappingResult } from './schema';
import type { CollectionMappingResult } from './mapper';
import { StrapiClient } from './strapiClient';
import { createImport, claimImport, getImport } from './importStore';
import { fetchDynamicCollections } from './dynamicCollections';
import {
  ContentTypeBuilderClient,
  ContentTypeAttribute,
  ContentTypeCreatePayload,
  toSingularName,
  toPluralName,
} from './contentTypeBuilder';
import {
  analyzeDocumentForSchema,
  compareDocumentSchema,
  proposedSchemaToCreatePayload,
} from './schemaAnalyzer';

const app = express();
app.use(express.json());

// CORS — allow the local Vite dev server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Import-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Config ---
const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN ?? '';
const STRAPI_ADMIN_JWT = process.env.STRAPI_ADMIN_JWT ?? '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const IMPORT_API_KEY = process.env.IMPORT_API_KEY ?? '';
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const MAX_FILE_SIZE_MB = 10;

// --- Auth middleware ---
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!IMPORT_API_KEY) return next(); // no key configured = open in dev
  const key = req.headers['x-import-key'];
  if (key !== IMPORT_API_KEY) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid X-Import-Key header' });
    return;
  }
  next();
}

app.use('/api/schema', requireApiKey, (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Schema changes are disabled. Create and maintain content types and components in Strapi, then refresh the collection list.',
  });
});

// --- Multer: .docx only, max 10 MB ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    const allowed =
      ext === '.docx' &&
      (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime === 'application/octet-stream');
    if (allowed) return cb(null, true);
    cb(new Error('Only .docx files are accepted'));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/import/collections
// Returns the list of importable collections (merged static + cached dynamic)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/import/collections', requireApiKey, (req: Request, res: Response) => {
  const connectionOrigin = req.query.connectionOrigin;
  if (!validateConnectionOrigin(connectionOrigin, STRAPI_URL)) {
    res.status(409).json({
      error: 'The connected GraphQL instance does not match the Strapi instance configured for imports.',
    });
    return;
  }
  res.json({ collections: getImportableCollections() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/import/collections/refresh
// Dynamically fetches content types from Strapi Content-Type Builder admin API.
// Requires STRAPI_ADMIN_JWT to be configured.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/import/collections/refresh', requireApiKey, async (req: Request, res: Response) => {
  const connectionOrigin = req.body?.connectionOrigin;
  if (!validateConnectionOrigin(connectionOrigin, STRAPI_URL)) {
    res.status(409).json({
      error: 'The connected GraphQL instance does not match the Strapi instance configured for imports.',
    });
    return;
  }

  if (!STRAPI_ADMIN_JWT) {
    clearDynamicCollectionsCache();
    // Fall back to static list if no admin JWT configured
    res.json({
      collections: getImportableCollections(),
      dynamic: false,
      warning: 'STRAPI_ADMIN_JWT is not configured. Dynamic collection discovery is unavailable. Using static registry.',
    });
    return;
  }

  try {
    const dynamic = await fetchDynamicCollections(STRAPI_URL, STRAPI_ADMIN_JWT);

    if (!dynamic) {
      clearDynamicCollectionsCache();
      res.json({
        collections: getImportableCollections(),
        dynamic: false,
        warning: 'Could not fetch dynamic collections from Strapi. Check that STRAPI_ADMIN_JWT is valid and Strapi is running.',
      });
      return;
    }

    setDynamicCollectionsCache(dynamic);

    res.json({
      collections: getImportableCollections(),
      dynamic: true,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[refresh] Error fetching dynamic collections:', err?.message);
    res.status(500).json({
      error: err?.message ?? 'Failed to refresh collections',
      collections: getImportableCollections(),
      dynamic: false,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/import/preview
// Upload docx → extract → selected-schema map → validate → return preview + importId
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  '/api/import/preview',
  requireApiKey,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Send a .docx as multipart/form-data field "file".' });
        return;
      }

      const collection = getImportCollection(req.body?.collectionId);
      if (!collection) {
        res.status(400).json({ error: 'The selected collection is not enabled in the verified import registry.' });
        return;
      }
      const connectionOrigin = req.body?.connectionOrigin;
      if (!validateConnectionOrigin(connectionOrigin, STRAPI_URL)) {
        res.status(409).json({
          error: 'The connected GraphQL instance does not match the Strapi instance configured for imports.',
        });
        return;
      }

      // Phase 2: extract structured content
      const doc = await extractDocx(req.file.buffer, req.file.originalname);

      const mappingResult = await mapDocumentToCollection(
        doc,
        collection,
        GEMINI_API_KEY,
        GEMINI_MODEL,
      );

      const validation = validateImportPayload(collection, mappingResult.payload);
      if (!validation.success) {
        res.status(422).json({
          error: 'Validation failed — no entry will be created',
          validationErrors: validation.errors.map((message) => ({ message })),
          filename: req.file.originalname,
        });
        return;
      }

      if (aiResult.payload.contentNew !== undefined && aiResult.payload.contentNew !== null) {
        if (!Array.isArray(aiResult.payload.contentNew)) {
          res.status(422).json({
            error: 'Validation failed — contentNew must be an array of component objects',
            validationErrors: [{ message: 'contentNew must be an array of component objects, not a string or object' }],
            aiResult,
          });
          return;
        }
        for (let idx = 0; idx < aiResult.payload.contentNew.length; idx++) {
          const item = (aiResult.payload.contentNew as any[])[idx];
          if (!item || typeof item !== 'object') {
            res.status(422).json({
              error: 'Validation failed — invalid component item',
              validationErrors: [{ message: `contentNew[${idx}] is not an object` }],
              aiResult,
            });
            return;
          }
          if (item.title !== undefined && item.title !== null && typeof item.title !== 'string') {
            res.status(422).json({
              error: 'Validation failed — component title must be a string',
              validationErrors: [{ message: `contentNew[${idx}].title must be a string` }],
              aiResult,
            });
            return;
          }
          if (item.content !== undefined && item.content !== null && typeof item.content !== 'string') {
            res.status(422).json({
              error: 'Validation failed — contentNew content must be a string',
              validationErrors: [{ message: `contentNew[${idx}].content must be a string` }],
              aiResult,
            });
            return;
          }
        }
      }

      // Single types have one shared entry and do not support duplicate checks.
      const strapi = new StrapiClient(STRAPI_URL, STRAPI_API_TOKEN);
      let duplicateDocumentId: string | null = null;
      const duplicateValue = collection.duplicateField
        ? validation.data[collection.duplicateField]
        : undefined;
      if (collection.kind !== 'singleType' && collection.duplicateField && typeof duplicateValue === 'string') {
        const existing = await strapi.findByField(collection, collection.duplicateField, duplicateValue);
        if (existing) duplicateDocumentId = existing.documentId;
      }

      // Build image info for preview (base64 thumbnails for display, not stored)
      const imagePreview = doc.images.map((img) => ({
        index: img.index,
        filename: img.filename,
        contentType: img.contentType,
        sizeBytes: img.buffer.length,
        altText: img.altText,
        caption: img.caption,
        location: img.location,
        ...(img.relationshipId ? { relationshipId: img.relationshipId } : {}),
        // Small base64 preview (cap at 50KB for preview)
        preview: img.buffer.length <= 50 * 1024
          ? `data:${img.contentType};base64,${img.buffer.toString('base64')}`
          : null,
      }));

      // Store for confirm step
      const importId = createImport(
        collection.uid,
        connectionOrigin,
        validation.data,
        mappingResult,
        doc.images,
        req.file.originalname,
        doc,
      );

      res.json({
        importId,
        preview: {
          collection: {
            uid: collection.uid,
            displayName: collection.displayName,
            apiName: collection.apiName,
          },
          documentName: req.file.originalname,
          payload: validation.data,
          images: imagePreview,
          duplicateDocumentId,
          debug: {
            fieldStates: mappingResult.fieldStates,
            missingRequiredFields: mappingResult.missingFields,
            ambiguities: mappingResult.ambiguities,
            warnings: mappingResult.warnings,
            contentWarnings: doc.contentWarnings,
            ignoredDocumentFields: doc.unmappedFields,
          },
        },
      });
    } catch (err: any) {
      console.error('[preview] Error:', err?.message ?? err);
      res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/import/confirm
// importId → create draft → upload images → verify → return documentId
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/import/confirm', requireApiKey, async (req: Request, res: Response) => {
  let createdDocumentId: string | undefined;
  let createdAdminLink: string | undefined;
  try {
    const { importId, imageAssignments, skipUnassignedImages } = req.body as {
      importId?: string;
      /**
       * Optional manual image-to-field assignments from the user.
       * Keys are field names (e.g. "coverImage"), values are image indices.
       */
      imageAssignments?: Record<string, number | number[]>;
      skipUnassignedImages?: boolean;
    };
    if (!importId) {
      res.status(400).json({ error: 'importId is required' });
      return;
    }

    const pending = claimImport(importId);
    if (!pending) {
      res.status(404).json({ error: 'Import session not found, expired, or already submitted. Re-upload the file for a new preview.' });
      return;
    }

    const collection = getImportCollection(pending.collectionId);
    if (!collection || !validateConnectionOrigin(pending.connectionOrigin, STRAPI_URL)) {
      res.status(409).json({ error: 'The selected collection or Strapi connection has changed. Re-preview the document.' });
      return;
    }

    const validation = validateImportPayload(collection, pending.payload);
    if (!validation.success) {
      res.status(422).json({
        error: 'The stored preview no longer validates against the selected collection schema.',
        validationErrors: validation.errors.map((message) => ({ message })),
      });
      return;
    }

    const strapi = new StrapiClient(STRAPI_URL, STRAPI_API_TOKEN);

    // Idempotency: check for duplicate before creating
    const duplicateValue = collection.duplicateField
      ? validation.data[collection.duplicateField]
      : undefined;
    if (collection.kind !== 'singleType' && collection.duplicateField && typeof duplicateValue === 'string') {
      const existing = await strapi.findByField(collection, collection.duplicateField, duplicateValue);
      if (existing) {
        res.status(409).json({
          error: `Duplicate: an entry with this ${collection.displayName} identifier already exists as draft.`,
          documentId: existing.documentId,
          adminLink: `${STRAPI_URL}/admin/content-manager/collection-types/${collection.uid}/${existing.documentId}`,
        });
        return;
      }
    }

    // Resolve image assignments
    // Priority: 1. manual imageAssignments from frontend, 2. auto-detected from fieldStates
    // Build a map of fieldName -> image to upload
    const mediaUploads: Array<{ fieldName: string; image: typeof pending.images[0] }> = [];

    if (imageAssignments && Object.keys(imageAssignments).length > 0) {
      // User provided explicit assignments
      for (const [fieldName, assignedIndices] of Object.entries(imageAssignments)) {
        const field = collection.fields.find((candidate) =>
          candidate.name === fieldName && candidate.type === 'media' && candidate.supported);
        if (!field) {
          res.status(422).json({ error: `Image assignment targets unknown or non-media field "${fieldName}".` });
          return;
        }
        const indices = Array.isArray(assignedIndices) ? assignedIndices : [assignedIndices];
        if (!field.multiple && indices.length > 1) {
          res.status(422).json({ error: `Media field "${fieldName}" accepts only one image.` });
          return;
        }
        for (const imageIndex of indices) {
          const img = pending.images.find((candidate) => candidate.index === imageIndex);
          if (!img) {
            res.status(422).json({ error: `Assigned image ${imageIndex} is not available in this document.` });
            return;
          }
          if (!img.contentType.startsWith('image/')) {
            res.status(422).json({ error: `Image ${imageIndex} is not a supported image binary.` });
            return;
          }
          if (field.allowedTypes?.length && !field.allowedTypes.includes('images')) {
            res.status(422).json({ error: `Media field "${fieldName}" does not allow images.` });
            return;
          }
          if (!mediaUploads.some((upload) =>
            upload.fieldName === fieldName && upload.image.index === imageIndex)) {
            mediaUploads.push({ fieldName, image: img });
          }
        }
      }
    } else if (pending.aiResult && skipUnassignedImages !== true) {
      for (const field of collection.fields.filter((candidate) =>
        candidate.type === 'media' && candidate.supported)) {
        const sourceField = field.sourceField ?? field.name;
        const imageIndex = pending.document?.fieldStates[sourceField]?.imageIndex ??
          (pending.aiResult as CollectionMappingResult).fieldStates[field.name]?.imageIndex;
        if (imageIndex === undefined) continue;
        const image = pending.images.find((candidate) => candidate.index === imageIndex);
        if (!image) throw new Error(`Media field "${field.name}" references unavailable image ${imageIndex}.`);
        mediaUploads.push({ fieldName: field.name, image });
      }
    }
    const assignedImageIndexes = new Set(mediaUploads.map((upload) => upload.image.index));
    const unassignedImages = pending.images
      .filter((image) => !assignedImageIndexes.has(image.index))
      .map((image) => image.index);
    const hasSupportedMediaField = collection.fields.some((field) =>
      field.type === 'media' && field.supported,
    );
    if (hasSupportedMediaField && unassignedImages.length > 0 && skipUnassignedImages !== true) {
      res.status(422).json({
        error: `Images ${unassignedImages.join(', ')} are not assigned to a media field. Assign them or explicitly confirm skipping unassigned images.`,
      });
      return;
    }
    for (const field of collection.fields.filter((candidate) =>
      candidate.type === 'media' && candidate.required)) {
      if (!mediaUploads.some((upload) => upload.fieldName === field.name)) {
        res.status(422).json({ error: `Required media field "${field.name}" needs an image assignment.` });
        return;
      }
    }

    // Phase 5: create draft (drafts only, never published)
    const created = await strapi.createDraftForCollection(collection, validation.data);
    createdDocumentId = created.documentId;
    createdAdminLink = created.adminLink;
    console.log(`[confirm] Created ${collection.uid} draft documentId=${created.documentId}`);

    // Upload media fields
    const uploadedMedia: Record<string, number[]> = {};
    for (const { fieldName, image } of mediaUploads) {
      const mediaId = await strapi.uploadMedia(image, created.id, fieldName, collection.uid);
      uploadedMedia[fieldName] ??= [];
      uploadedMedia[fieldName].push(mediaId);
      console.log(`[confirm] Uploaded ${fieldName} mediaId=${mediaId}`);
    }

    // Legacy compat: single uploadedImageId for article cover
    const uploadedImageId = uploadedMedia['coverImage']?.[0] ?? null;

    // Verify: re-fetch and diff
    const saved = await strapi.getByDocumentIdForCollection(collection, created.documentId);
    const mismatches = diffPayload(validation.data, saved);
    for (const [fieldName, mediaIds] of Object.entries(uploadedMedia)) {
      for (const mediaId of mediaIds) {
        if (!mediaReferenceContainsId(saved[fieldName], mediaId)) {
          mismatches.push(`${fieldName}: uploaded media ${mediaId} is not linked in the saved entry.`);
        }
      }
    }

    res.json({
      success: true,
      documentId: created.documentId,
      collection: { uid: collection.uid, displayName: collection.displayName },
      adminLink: created.adminLink,
      previewLink: `http://localhost:5173`,
      uploadedImageId,
      uploadedMedia,
      verification: {
        ok: mismatches.length === 0,
        mismatches,
      },
    });
  } catch (err: any) {
    const strapiErr = (err as any)?.strapiError;
    console.error('[confirm] Error:', err?.message ?? err);
    res.status(strapiErr?.status ?? 500).json({
      error: err?.message ?? 'Internal server error',
      hint: strapiErr?.hint,
      ...(createdDocumentId ? { documentId: createdDocumentId } : {}),
      ...(createdAdminLink ? { adminLink: createdAdminLink } : {}),
      ...(createdDocumentId ? {
        mediaUploadFailed: true,
        message: 'A draft was created, but media processing did not complete. Review the draft before retrying.',
      } : {}),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/schema/analyze
// Upload docx → extract → analyze → return proposed schema (no side effects)
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  '/api/schema/analyze',
  requireApiKey,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded.' });
        return;
      }

      const kind = (req.body?.kind === 'singleType' ? 'singleType' : 'collectionType') as 'collectionType' | 'singleType';
      const proposedDisplayName = typeof req.body?.displayName === 'string'
        ? req.body.displayName.trim() || undefined
        : undefined;

      const doc = await extractDocx(req.file.buffer, req.file.originalname);
      const proposed = analyzeDocumentForSchema(doc, proposedDisplayName, kind);

      // Check compatibility with existing collections (if admin JWT available)
      let compatibilityChecks: any[] = [];
      if (STRAPI_ADMIN_JWT) {
        try {
          const { fetchDynamicCollections: fetchDyn } = await import('./dynamicCollections');
          const { checkSchemaCompatibility } = await import('./schemaAnalyzer');
          const existing = await fetchDyn(STRAPI_URL, STRAPI_ADMIN_JWT);
          if (existing) {
            compatibilityChecks = existing
              .map((col) => {
                const attrMap: Record<string, { type: string }> = {};
                for (const f of col.fields) attrMap[f.name] = { type: f.type };
                return checkSchemaCompatibility(proposed, attrMap, col.uid, col.displayName);
              })
              .filter((check) => check.score > 30)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);
          }
        } catch (err: any) {
          console.warn('[schema/analyze] Compatibility check failed:', err?.message);
        }
      }

      res.json({
        proposed,
        compatibilityChecks,
        filename: req.file.originalname,
        wordCount: doc.metadata.wordCount,
        imageCount: doc.images.length,
      });
    } catch (err: any) {
      console.error('[schema/analyze] Error:', err?.message);
      res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/schema/apply
// Adds only explicitly approved fields to an existing content type.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/schema/apply', requireApiKey, async (req: Request, res: Response) => {
  const { importId, approvedFields, confirmed } = req.body as {
    importId?: string;
    approvedFields?: string[];
    confirmed?: boolean;
  };
  if (confirmed !== true) {
    res.status(400).json({ error: 'Schema additions require confirmed: true.' });
    return;
  }
  if (!importId || !Array.isArray(approvedFields) || approvedFields.length === 0 ||
    approvedFields.some((name) => typeof name !== 'string')) {
    res.status(400).json({ error: 'importId and at least one approved field name are required.' });
    return;
  }
  if (!STRAPI_ADMIN_JWT) {
    res.status(503).json({
      error: 'STRAPI_ADMIN_JWT is not configured. Additive schema changes require authorized Content-Type Builder access.',
    });
    return;
  }

  const pending = getImport(importId);
  if (!pending?.document) {
    res.status(404).json({ error: 'Import analysis not found or expired. Upload and analyze the document again.' });
    return;
  }
  const collection = getImportCollection(pending.collectionId);
  if (!collection || !validateConnectionOrigin(pending.connectionOrigin, STRAPI_URL)) {
    res.status(409).json({ error: 'The selected content type or Strapi connection has changed. Re-analyze the document.' });
    return;
  }

  try {
    const liveCollections = await fetchDynamicCollections(STRAPI_URL, STRAPI_ADMIN_JWT);
    if (!liveCollections) {
      res.status(503).json({ error: 'Unable to read the current authorized Strapi schema. No schema change was attempted.' });
      return;
    }
    setDynamicCollectionsCache(liveCollections);
    const liveCollection = liveCollections.find((candidate) => candidate.uid === collection.uid);
    if (!liveCollection) {
      res.status(404).json({ error: `Content type "${collection.uid}" is not available in the connected Strapi instance.` });
      return;
    }

    const diff = compareDocumentSchema(pending.document, {
      ...liveCollection,
      kind: liveCollection.kind,
    });
    const proposedByName = new Map(diff.missingFields.map((field) => [field.name, field]));
    const approvedUnique = [...new Set(approvedFields)];
    const unapprovedNames = approvedUnique.filter((name) => !proposedByName.has(name));
    if (unapprovedNames.length > 0) {
      res.status(400).json({
        error: `Only fields in the current additive schema preview can be approved: ${unapprovedNames.join(', ')}`,
      });
      return;
    }

    const attributes: Record<string, ContentTypeAttribute> = {};
    for (const name of approvedUnique) {
      const field = proposedByName.get(name)!;
      if (!['string', 'text', 'richtext', 'uid', 'email', 'date', 'datetime', 'boolean', 'integer', 'float', 'decimal', 'media'].includes(field.type)) {
        res.status(422).json({ error: `Field "${name}" requires unsupported manual configuration (${field.type}).` });
        return;
      }
      attributes[name] = field.type === 'media'
        ? { type: 'media', multiple: false, allowedTypes: ['images'] }
        : { ...field.attributes, required: false };
    }

    const builder = new ContentTypeBuilderClient(STRAPI_URL, STRAPI_ADMIN_JWT);
    await builder.addAttributes(collection.uid, attributes);

    let refreshed = false;
    let lastRefreshError: unknown;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const freshTypes = await fetchDynamicCollections(STRAPI_URL, STRAPI_ADMIN_JWT);
        const freshCollection = freshTypes?.find((candidate) => candidate.uid === collection.uid);
        if (freshTypes && freshCollection &&
          approvedUnique.every((name) => freshCollection.fields.some((field) => field.name === name))) {
          setDynamicCollectionsCache(freshTypes);
          const updated = getImportCollection(collection.uid);
          if (!updated) throw new Error('Refreshed content type disappeared from the import registry.');
          const revalidatedDiff = compareDocumentSchema(pending.document, updated);
          const stillMissing = approvedUnique.filter((name) =>
            revalidatedDiff.missingFields.some((field) => field.name === name));
          if (stillMissing.length === 0) {
            refreshed = true;
            break;
          }
        }
      } catch (error) {
        lastRefreshError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!refreshed) {
      clearDynamicCollectionsCache();
      res.status(202).json({
        success: true,
        refreshed: false,
        addedFields: approvedUnique,
        warning: `Strapi accepted the additive schema update, but its refreshed schema could not yet be verified${lastRefreshError instanceof Error ? `: ${lastRefreshError.message}` : ''}. Wait for Strapi to reload, then refresh the selector and re-analyze before importing.`,
      });
      return;
    }

    res.json({
      success: true,
      refreshed: true,
      addedFields: approvedUnique,
      message: 'Approved fields were added and verified against the refreshed Strapi schema. Re-analyze the document before importing.',
    });
  } catch (err: any) {
    console.error('[schema/apply] Error:', err?.message ?? err);
    res.status(err?.strapiError?.status ?? 500).json({
      error: err?.message ?? 'Schema update failed.',
      hint: 'Existing fields are never replaced. Verify Content-Type Builder permissions and the Strapi development mode requirement.',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/schema/create
// Create a new Strapi content type via the Content-Type Builder admin API.
// Requires STRAPI_ADMIN_JWT. Requires explicit user confirmation.
// NEVER auto-creates schemas — always requires the "confirmed: true" flag.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/schema/create', requireApiKey, async (req: Request, res: Response) => {
  const { payload, confirmed } = req.body as {
    payload?: ContentTypeCreatePayload;
    confirmed?: boolean;
  };

  if (!confirmed) {
    res.status(400).json({
      error: 'Schema creation requires explicit confirmation. Set confirmed: true to proceed.',
    });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'A content type payload is required.' });
    return;
  }
  if (
    !payload.info ||
    typeof payload.info.displayName !== 'string' ||
    typeof payload.info.singularName !== 'string' ||
    typeof payload.info.pluralName !== 'string' ||
    (payload.kind !== 'collectionType' && payload.kind !== 'singleType') ||
    !payload.attributes ||
    typeof payload.attributes !== 'object'
  ) {
    res.status(400).json({ error: 'The content type payload is incomplete or invalid.' });
    return;
  }

  if (!STRAPI_ADMIN_JWT) {
    res.status(503).json({
      error: 'STRAPI_ADMIN_JWT is not configured. Schema creation requires admin authorization.',
      hint: 'Add STRAPI_ADMIN_JWT to word-to-strapi-service/.env. This is the JWT token from Strapi Admin → Profile, not the API token.',
    });
    return;
  }

  try {
    const builder = new ContentTypeBuilderClient(STRAPI_URL, STRAPI_ADMIN_JWT);

    // Verify admin JWT is still valid before attempting
    const ping = await builder.ping();
    if (!ping.ok) {
      res.status(401).json({
        error: `Admin JWT is invalid or expired: ${ping.error}`,
        hint: 'Obtain a fresh JWT by signing in to Strapi Admin → Profile → Copy the JWT token from the Authorization header in browser DevTools.',
      });
      return;
    }

    console.log(`[schema/create] Creating ${payload.kind}: ${payload.info.displayName}`);
    const result = await builder.createContentType(payload);
    console.log(`[schema/create] Created: ${result.uid}`);

    // Refresh dynamic collections cache after creation
    const fresh = await fetchDynamicCollections(STRAPI_URL, STRAPI_ADMIN_JWT);
    if (fresh) setDynamicCollectionsCache(fresh);

    res.json({
      success: true,
      uid: result.uid,
      kind: result.kind,
      displayName: result.info.displayName,
      message: `Content type "${result.info.displayName}" created successfully. Strapi will restart to apply the schema changes.`,
      warning: 'Strapi is restarting. Wait 15–30 seconds before attempting to import content into this new type.',
    });
  } catch (err: any) {
    console.error('[schema/create] Error:', err?.message);
    res.status(500).json({
      error: err?.message ?? 'Schema creation failed',
      hint: 'Check that Strapi is running, STRAPI_ADMIN_JWT is valid, and the content type name is unique.',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schema/admin-status
// Check whether admin JWT is configured and valid.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/schema/admin-status', requireApiKey, async (_req: Request, res: Response) => {
  if (!STRAPI_ADMIN_JWT) {
    res.json({
      configured: false,
      valid: false,
      message: 'STRAPI_ADMIN_JWT is not set. Dynamic collection discovery and schema creation are unavailable.',
    });
    return;
  }

  try {
    const builder = new ContentTypeBuilderClient(STRAPI_URL, STRAPI_ADMIN_JWT);
    const ping = await builder.ping();
    res.json({
      configured: true,
      valid: ping.ok,
      message: ping.ok
        ? 'Admin JWT is configured and valid. Dynamic discovery and schema creation are available.'
        : `Admin JWT is configured but invalid: ${ping.error}`,
    });
  } catch (err: any) {
    res.json({
      configured: true,
      valid: false,
      message: `Admin JWT check failed: ${err?.message}`,
    });
  }
});

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    strapiUrl: STRAPI_URL,
    geminiModel: GEMINI_MODEL,
    geminiKeySet: !!GEMINI_API_KEY,
    strapiTokenSet: !!STRAPI_API_TOKEN,
    adminJwtSet: !!STRAPI_ADMIN_JWT,
  });
});

// --- Error handler for multer ---
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `File too large. Max size: ${MAX_FILE_SIZE_MB}MB` });
    return;
  }
  res.status(400).json({ error: err?.message ?? 'Bad request' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[word-to-strapi-service] Running on http://localhost:${PORT}`);
    console.log(`  Strapi URL: ${STRAPI_URL}`);
    console.log(`  Strapi API token: ${STRAPI_API_TOKEN ? '*** (set)' : '⚠ NOT SET'}`);
    console.log(`  Strapi Admin JWT: ${STRAPI_ADMIN_JWT ? '*** (set)' : '⚠ NOT SET — live collection discovery unavailable'}`);
    console.log(`  Gemini key: ${GEMINI_API_KEY ? '*** (set)' : '⚠ NOT SET — using rule-based fallback'}`);
  });
}

export default app;

// --- Helpers ---
export function diffPayload(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): string[] {
  const mismatches: string[] = [];
  for (const [key, val] of Object.entries(expected)) {
    const act = actual[key];
    const isExpectedEmpty = val === null || val === undefined;
    const isActualEmpty = act === null || act === undefined || act === '';
    if (isExpectedEmpty && isActualEmpty) {
      continue;
    }
    if (!matchesExpectedValue(val, act)) {
      if (key === 'contentNew' && Array.isArray(val)) {
        const actArr = Array.isArray(act) ? act : [];
        if (val.length !== actArr.length) {
          mismatches.push(`contentNew: expected ${val.length} component items, but Strapi saved ${actArr.length}`);
        } else {
          mismatches.push(`contentNew: component content or titles do not match the expected values.`);
        }
      } else {
        mismatches.push(
          `${key}: expected "${String(val)?.substring(0, 60)}", got "${String(act)?.substring(0, 60)}"`
        );
      }
    }
  }
  return mismatches;
}

function matchesExpectedValue(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined || actual === '';
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => matchesExpectedValue(value, actual[index]));
  }
  if (isRecordValue(expected)) {
    const actualRecord = isRecordValue(actual) && isRecordValue(actual.data) ? actual.data : actual;
    return isRecordValue(actualRecord) &&
      Object.entries(expected).every(([key, value]) => matchesExpectedValue(value, actualRecord[key]));
  }
  return expected === actual;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mediaReferenceContainsId(value: unknown, mediaId: number): boolean {
  if (Array.isArray(value)) return value.some((entry) => mediaReferenceContainsId(entry, mediaId));
  if (!isRecordValue(value)) return false;
  if (value.id === mediaId) return true;
  if (isRecordValue(value.data)) return mediaReferenceContainsId(value.data, mediaId);
  return false;
}
