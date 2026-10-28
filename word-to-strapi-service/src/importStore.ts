import crypto from 'crypto';
import type { AiMappingResult } from './schema.js';
import type { ExtractedDocument } from './extract.js';
import type { ExtractedImage } from './extract.js';
import type { CollectionMappingResult } from './mapper.js';

export interface PendingImport {
  importId: string;
  collectionId: string;
  connectionOrigin: string;
  payload: Record<string, unknown>;
  aiResult: AiMappingResult | CollectionMappingResult;
  images: ExtractedImage[];
  document?: ExtractedDocument;
  filename: string;
  createdAt: number;
}

// In-memory store with 30-minute TTL
const store = new Map<string, PendingImport>();
const TTL_MS = 30 * 60 * 1000;

export function createImport(
  collectionId: string,
  connectionOrigin: string,
  payload: Record<string, unknown>,
  aiResult: AiMappingResult | CollectionMappingResult,
  images: ExtractedImage[],
  filename: string,
  document?: ExtractedDocument,
): string {
  const importId = crypto.randomUUID();
  store.set(importId, {
    importId,
    collectionId,
    connectionOrigin,
    payload,
    aiResult,
    images,
    document,
    filename,
    createdAt: Date.now(),
  });
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

export function claimImport(importId: string): PendingImport | undefined {
  const item = getImport(importId);
  if (!item) return undefined;
  store.delete(importId);
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
