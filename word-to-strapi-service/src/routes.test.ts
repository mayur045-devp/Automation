import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import app from './index';
import { clearDynamicCollectionsCache } from './collections';

const API_KEY = process.env.IMPORT_API_KEY || 'dev_local_key_123';
const authHeaders = {
  'x-import-key': API_KEY,
  'Content-Type': 'application/json',
};

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
    it('does not expose schema administration through the import service', async () => {
      const res = await fetch(`${baseUrl}/api/schema/admin-status`, {
        headers: { 'x-import-key': API_KEY },
      });
      expect(res.status).toBe(410);
      const data = await res.json();
      expect(data.error).toMatch(/Schema changes are disabled/i);
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

  describe('Schema changes remain disabled', () => {
    it('rejects schema analysis, creation, and updates without contacting Content-Type Builder', async () => {
      for (const route of ['/api/schema/analyze', '/api/schema/create', '/api/schema/apply']) {
        const res = await fetch(`${baseUrl}${route}`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ confirmed: true, payload: {}, approvedFields: ['title'] }),
        });
        expect(res.url).toContain(route);
        expect(res.status).toBe(410);
        const data = await res.json();
        expect(data.error).toMatch(/Schema changes are disabled/i);
      }
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
