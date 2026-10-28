import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrapiClient } from './strapiClient';
import type { ExtractedImage } from './extract';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Strapi media uploads', () => {
  it('uploads the embedded binary and attaches it to the selected Strapi field', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const image: ExtractedImage = {
      index: 0,
      altText: 'Cover photo',
      caption: 'Cover image',
      location: 'Paragraph 2: Cover image',
      buffer: bytes,
      contentType: 'image/png',
      filename: 'cover.png',
    };
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get('refId')).toBe('41');
      expect(form.get('ref')).toBe('api::blog.blog');
      expect(form.get('field')).toBe('cover');
      expect(JSON.parse(String(form.get('fileInfo')))).toEqual({
        name: 'cover.png',
        alternativeText: 'Cover photo',
        caption: 'Cover image',
      });
      const file = form.get('files');
      expect(file).toBeInstanceOf(Blob);
      expect((file as File).name).toBe('cover.png');
      expect((file as File).type).toBe('image/png');
      expect(Buffer.from(await (file as File).arrayBuffer())).toEqual(bytes);
      expect(init?.headers).not.toHaveProperty('Content-Type');
      return new Response(JSON.stringify([{ id: 501 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new StrapiClient('http://localhost:1337', 'test-token');
    await expect(client.uploadMedia(image, 41, 'cover', 'api::blog.blog')).resolves.toBe(501);
  });

  it('rejects upload responses without a valid Strapi media ID', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([{ url: '/uploads/image.png' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const image: ExtractedImage = {
      index: 0,
      altText: '',
      caption: '',
      location: 'Document',
      buffer: Buffer.from([1]),
      contentType: 'image/png',
      filename: 'image.png',
    };
    const client = new StrapiClient('http://localhost:1337', 'test-token');

    await expect(client.uploadMedia(image, 41, 'cover', 'api::blog.blog'))
      .rejects.toThrow(/valid media id/i);
  });
});
