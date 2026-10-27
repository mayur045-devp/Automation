import crypto from 'crypto';
import type { ArticlePayload, AiMappingResult } from './schema.js';
import type { ExtractedImage } from './extract.js';

export interface PendingImport {
  importId: string;
  payload: ArticlePayload;
  aiResult: AiMappingResult;
  images: ExtractedImage[];
  filename: string;
  createdAt: number;
}

// In-memory store with 30-minute TTL
const store = new Map<string, PendingImport>();
const TTL_MS = 30 * 60 * 1000;

export function createImport(
  payload: ArticlePayload,
  aiResult: AiMappingResult,
  images: ExtractedImage[],
  filename: string
): string {
  const importId = crypto.randomUUID();
  store.set(importId, { importId, payload, aiResult, images, filename, createdAt: Date.now() });
  return importId;
}

export function getImport(importId: string): PendingImport | undefined {
  const item = store.get(importId);
  if (!item) return undefined;
  if (Date.now() - item.createdAt > TTL_MS) {
    store.delete(importId);
    return undefined;
  }
  return item;
}

export function deleteImport(importId: string): void {
  store.delete(importId);
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of store.entries()) {
    if (now - item.createdAt > TTL_MS) store.delete(id);
  }
}, 5 * 60 * 1000);
