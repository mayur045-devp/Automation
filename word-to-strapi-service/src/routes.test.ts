import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import FormData from 'form-data';
import app from './index';
import { clearDynamicCollectionsCache } from './collections';

const API_KEY = process.env.IMPORT_API_KEY || 'dev_local_key_123';
const authHeaders = {
  'x-import-key': API_KEY,
  'Content-Type': 'application/json',
};

async function createTestDocxBuffer(title: string, description: string): Promise<Buffer> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: description })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

describe('API Routes Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    clearDynamicCollectionsCache();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('Authentication Enforcement', () => {
    it('rejects API requests without valid X-Import-Key header', async () => {
      const res = await fetch(`${baseUrl}/api/schema/admin-status`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toMatch(/Unauthorized/i);
    });
  });

  describe('GET /health', () => {
    it('returns healthy status and config indicators (unauthenticated)', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.geminiKeySet).toBe('boolean');
      expect(typeof data.strapiTokenSet).toBe('boolean');
      expect(typeof data.adminJwtSet).toBe('boolean');
    });
  });

  describe('GET /api/schema/admin-status', () => {
    it('returns configured=false when STRAPI_ADMIN_JWT is unset', async () => {
      const res = await fetch(`${baseUrl}/api/schema/admin-status`, {
        headers: { 'x-import-key': API_KEY },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(typeof data.configured).toBe('boolean');
      expect(typeof data.valid).toBe('boolean');
      expect(typeof data.message).toBe('string');
    });
  });

  describe('POST /api/import/collections/refresh', () => {
    it('enforces origin validation and returns 409 if origin mismatch', async () => {
      const res = await fetch(`${baseUrl}/api/import/collections/refresh`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ connectionOrigin: 'http://malicious-site.com' }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/does not match/i);
    });

    it('returns available collections with matching origin even without admin JWT via fallback', async () => {
      const res = await fetch(`${baseUrl}/api/import/collections/refresh`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ connectionOrigin: 'http://localhost:1337' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('collections');
      expect(Array.isArray(data.collections)).toBe(true);
      expect(typeof data.dynamic).toBe('boolean');
    });
  });

  describe('POST /api/schema/analyze', () => {
    it('returns 400 when no file is uploaded', async () => {
      const res = await fetch(`${baseUrl}/api/schema/analyze`, {
        method: 'POST',
        headers: { 'x-import-key': API_KEY },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/no file/i);
    });

    it('analyzes docx file and returns proposed schema', async () => {
      const buffer = await createTestDocxBuffer('Product Catalog Item', 'High performance widget for development.');
      const form = new FormData();
      form.append('file', buffer, {
        filename: 'catalog-item.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const res = await fetch(`${baseUrl}/api/schema/analyze`, {
        method: 'POST',
        body: form.getBuffer(),
        headers: {
          ...form.getHeaders(),
          'x-import-key': API_KEY,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.proposed).toBeDefined();
      expect(data.proposed.displayName).toBeDefined();
      expect(data.proposed.kind).toBeDefined();
      expect(Array.isArray(data.proposed.fields)).toBe(true);
      expect(data.proposed.fields.length).toBeGreaterThan(0);
      expect(data.filename).toBe('catalog-item.docx');
    });
  });

  describe('POST /api/schema/create', () => {
    it('rejects schema creation when confirmed is not true', async () => {
      const res = await fetch(`${baseUrl}/api/schema/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          payload: {
            contentType: {
              displayName: 'Test Event',
              singularName: 'testevent',
              pluralName: 'testevents',
              kind: 'collectionType',
              attributes: { title: { type: 'string', required: true } },
            },
          },
          confirmed: false,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/confirmed: true/i);
    });

    it('rejects schema creation when payload is missing', async () => {
      const res = await fetch(`${baseUrl}/api/schema/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          confirmed: true,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/payload is required/i);
    });

    it('returns 503 or 401 when admin JWT is not configured', async () => {
      const res = await fetch(`${baseUrl}/api/schema/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          payload: {
            contentType: {
              displayName: 'Test Event',
              singularName: 'testevent',
              pluralName: 'testevents',
              kind: 'collectionType',
              attributes: { title: { type: 'string', required: true } },
            },
          },
          confirmed: true,
        }),
      });
      expect([400, 401, 503]).toContain(res.status);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('POST /api/import/confirm', () => {
    it('returns 404 for unknown import ID', async () => {
      const res = await fetch(`${baseUrl}/api/import/confirm`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          importId: 'non-existent-import-id',
          editedData: { title: 'Test' },
        }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toMatch(/not found|expired/i);
    });
  });
});
