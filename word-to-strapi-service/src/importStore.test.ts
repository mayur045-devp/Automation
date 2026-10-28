import { describe, expect, it } from 'vitest';
import { claimImport, createImport } from './importStore';
import type { CollectionMappingResult } from './mapper';

describe('pending import confirmation claims', () => {
  it('allows a preview session to be claimed only once', () => {
    const aiResult: CollectionMappingResult = {
      fields: {},
      payload: {},
      fieldStates: {},
      missingFields: [],
      unmappedFields: [],
      ambiguities: [],
      warnings: [],
      confidence: 'high',
    };
    const importId = createImport(
      'api::blog.blog',
      'http://localhost:1337',
      {},
      aiResult,
      [],
      'import.docx',
    );

    expect(claimImport(importId)?.collectionId).toBe('api::blog.blog');
    expect(claimImport(importId)).toBeUndefined();
  });
});
