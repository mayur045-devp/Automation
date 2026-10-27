import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { extractDocx } from './extract';
import { mapDocumentToArticle } from './mapper';
import { validateArticlePayload } from './schema';
import { StrapiClient } from './strapiClient';
import { createImport, getImport, deleteImport } from './importStore';

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
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

// --- POST /api/import/preview ---
// Upload docx → extract → AI map → validate → return preview + importId
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

      // Phase 2: extract structured content
      const doc = await extractDocx(req.file.buffer, req.file.originalname);

      // Phase 4: map fields independently
      const aiResult = await mapDocumentToArticle(doc, GEMINI_API_KEY, GEMINI_MODEL);

      // Phase 3: validate payload against Strapi schema constraints
      const validation = validateArticlePayload(aiResult.payload);
      if (!validation.success) {
        res.status(422).json({
          error: 'Validation failed — no entry will be created',
          validationErrors: validation.errors,
          aiResult,
        });
        return;
      }

      // Duplicate check (idempotency check by Title)
      const strapi = new StrapiClient(STRAPI_URL, STRAPI_API_TOKEN);
      let duplicateDocumentId: string | null = null;
      if (aiResult.payload.Title) {
        const existing = await strapi.findByTitle(aiResult.payload.Title);
        if (existing) duplicateDocumentId = existing.documentId;
      }

      // Store for confirm step
      const importId = createImport(
        validation.data,
        aiResult,
        doc.images,
        req.file.originalname
      );

      res.json({
        importId,
        preview: {
          payload: validation.data,
          fields: aiResult.fields,
          missingFields: aiResult.missingFields,
          ambiguities: aiResult.ambiguities,
          confidence: aiResult.confidence,
          imageCount: doc.images.length,
          wordCount: doc.metadata.wordCount,
          duplicateDocumentId,
        },
      });
    } catch (err: any) {
      console.error('[preview] Error:', err?.message ?? err);
      res.status(500).json({ error: err?.message ?? 'Internal server error' });
    }
  }
);

// --- POST /api/import/confirm ---
// importId → create draft → upload images → verify → return documentId
app.post('/api/import/confirm', requireApiKey, async (req: Request, res: Response) => {
  try {
    const { importId } = req.body as { importId?: string };
    if (!importId) {
      res.status(400).json({ error: 'importId is required' });
      return;
    }

    const pending = getImport(importId);
    if (!pending) {
      res.status(404).json({ error: 'Import session not found or expired (30-min TTL). Re-upload the file.' });
      return;
    }

    const strapi = new StrapiClient(STRAPI_URL, STRAPI_API_TOKEN);

    // Idempotency: check for duplicate before creating
    if (pending.payload.Title) {
      const existing = await strapi.findByTitle(pending.payload.Title);
      if (existing) {
        deleteImport(importId);
        res.status(409).json({
          error: 'Duplicate: an article with this Title already exists as draft.',
          documentId: existing.documentId,
          adminLink: `${STRAPI_URL}/admin/content-manager/collection-types/api::article.article/${existing.documentId}`,
        });
        return;
      }
    }

    // Phase 5: create draft (drafts only, never published)
    const created = await strapi.createDraft(pending.payload);
    console.log(`[confirm] Created draft documentId=${created.documentId}`);

    // Upload cover image if real binary images exist
    let uploadedImageId: number | null = null;
    if (pending.images.length > 0) {
      try {
        uploadedImageId = await strapi.uploadMedia(pending.images[0], created.id, 'coverImage');
        console.log(`[confirm] Uploaded coverImage mediaId=${uploadedImageId}`);
      } catch (imgErr: any) {
        console.warn('[confirm] Image upload failed (entry still created):', imgErr?.message);
      }
    }

    // Verify: re-fetch and diff
    const saved = await strapi.getByDocumentId(created.documentId);
    const mismatches = diffPayload(pending.payload, saved);

    // Clean up store
    deleteImport(importId);

    res.json({
      success: true,
      documentId: created.documentId,
      adminLink: created.adminLink,
      previewLink: `http://localhost:5173`,
      uploadedImageId,
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

app.listen(PORT, () => {
  console.log(`[word-to-strapi-service] Running on http://localhost:${PORT}`);
  console.log(`  Strapi URL: ${STRAPI_URL}`);
  console.log(`  Strapi token: ${STRAPI_API_TOKEN ? '*** (set)' : '⚠ NOT SET'}`);
  console.log(`  Gemini key: ${GEMINI_API_KEY ? '*** (set)' : '⚠ NOT SET — using rule-based fallback'}`);
});

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
    if (val !== act) {
      mismatches.push(
        `${key}: expected "${String(val)?.substring(0, 60)}", got "${String(act)?.substring(0, 60)}"`
      );
    }
  }
  return mismatches;
}
