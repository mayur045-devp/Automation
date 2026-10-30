/**
 * schemaAnalyzer.ts
 *
 * Analyzes an extracted DOCX document and infers a proposed Strapi 5 content type schema.
 * This is a best-effort inference — all results must be reviewed and confirmed by the user
 * before any schema change is performed.
 *
 * Does NOT create schemas. Does NOT write to Strapi. Pure analysis only.
 */

import type { ExtractedDocument } from './extract';
import type { ImportCollection } from './collections';
import type { ContentTypeAttribute, ContentTypeCreatePayload } from './contentTypeBuilder';
import { DOCUMENT_FIELD_MAPPINGS } from './schema';
import { toSingularName, toPluralName } from './contentTypeBuilder';

export interface InferredField {
  /** Proposed Strapi attribute name */
  name: string;
  /** Inferred Strapi attribute type */
  type: string;
  /** Attributes for the field */
  attributes: ContentTypeAttribute;
  /** The source value(s) from the document used to infer this field */
  sourceValue: string | null;
  /** Confidence in this inference */
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable explanation */
  reason: string;
  /** True if the inferred type is uncertain — user must verify */
  uncertain: boolean;
}

export interface ProposedSchema {
  /** Proposed display name for the content type */
  displayName: string;
  /** Proposed singular API name */
  singularName: string;
  /** Proposed plural API name */
  pluralName: string;
  /** Collection type or single type */
  kind: 'collectionType' | 'singleType';
  /** Whether draft/publish should be enabled */
  draftAndPublish: boolean;
  /** Inferred fields */
  fields: InferredField[];
  /** Overall confidence in the schema */
  confidence: 'high' | 'medium' | 'low';
  /** Warnings about the inference */
  warnings: string[];
  /** Fields or structures that couldn't be automatically represented */
  unrepresentable: string[];
}

/** Known field name patterns → Strapi type */
const FIELD_TYPE_HINTS: Array<{
  patterns: RegExp[];
  type: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}> = [
  { patterns: [/^title$/i, /^name$/i, /^heading$/i], type: 'string', confidence: 'high', reason: 'Common title/name fields are string type.' },
  { patterns: [/^slug$/i, /^url$/i, /^permalink$/i], type: 'uid', confidence: 'high', reason: 'URL-like fields map to Strapi uid type.' },
  { patterns: [/^description$/i, /^summary$/i, /^excerpt$/i, /^abstract$/i], type: 'text', confidence: 'high', reason: 'Description/summary fields are text type.' },
  { patterns: [/^content$/i, /^body$/i, /^article$/i, /^post$/i, /^copy$/i], type: 'richtext', confidence: 'high', reason: 'Main content fields are richtext type.' },
  { patterns: [/^date$/i, /^publish(ed)?/i, /^created(at)?/i], type: 'date', confidence: 'high', reason: 'Date-like field names map to date type.' },
  { patterns: [/^email$/i, /^mail$/i], type: 'email', confidence: 'high', reason: 'Email fields map to email type.' },
  { patterns: [/^cover$/i, /^image$/i, /^photo$/i, /^thumbnail$/i, /^banner$/i, /^hero$/i], type: 'media', confidence: 'high', reason: 'Image/photo fields are media type.' },
  { patterns: [/^author$/i, /^by$/i, /^writer$/i], type: 'string', confidence: 'medium', reason: 'Author name mapped to string (use relation for linked author entries).' },
  { patterns: [/^category$/i, /^tag$/i, /^topic$/i], type: 'string', confidence: 'medium', reason: 'Category mapped to string (use relation for linked category entries).' },
  { patterns: [/^time$/i, /^duration$/i, /^readtime$/i, /^reading/i], type: 'string', confidence: 'medium', reason: 'Time/duration mapped to string.' },
  { patterns: [/^price$/i, /^cost$/i, /^amount$/i], type: 'decimal', confidence: 'high', reason: 'Price/cost fields map to decimal type.' },
  { patterns: [/^count$/i, /^number$/i, /^quantity$/i, /^order$/i], type: 'integer', confidence: 'medium', reason: 'Numeric count fields map to integer type.' },
  { patterns: [/^enabled$/i, /^active$/i, /^published$/i, /^visible$/i, /^featured$/i], type: 'boolean', confidence: 'high', reason: 'True/false flags are boolean type.' },
  { patterns: [/^seo$/i, /^meta$/i, /^metatitle$/i, /^metadesc/i], type: 'component', confidence: 'medium', reason: 'SEO fields are best represented as a component.' },
  { patterns: [/^contentnew$/i], type: 'component', confidence: 'high', reason: 'Repeatable contentNew component.' },
];

/** Infer Strapi type from a field name and its value */
function inferFieldType(
  fieldName: string,
  value: string | null
): { type: string; confidence: 'high' | 'medium' | 'low'; reason: string; uncertain: boolean } {
  const lowerName = fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Check pattern hints
  for (const hint of FIELD_TYPE_HINTS) {
    if (hint.patterns.some((p) => p.test(fieldName))) {
      // Skip component hints for simple inference; flag as uncertain
      const uncertain = hint.type === 'component' || hint.type === 'media';
      return { type: hint.type, confidence: hint.confidence, reason: hint.reason, uncertain };
    }
  }

  // Value-based inference as fallback
  if (value) {
    const trimmed = value.trim();

    // Date pattern
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return { type: 'date', confidence: 'high', reason: 'Value matches YYYY-MM-DD date format.', uncertain: false };
    }
    // ISO date-time
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      return { type: 'datetime', confidence: 'high', reason: 'Value matches ISO datetime format.', uncertain: false };
    }
    // URL
    if (/^https?:\/\//.test(trimmed)) {
      return { type: 'string', confidence: 'medium', reason: 'Value is a URL; mapped to string.', uncertain: true };
    }
    // Number
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return { type: trimmed.includes('.') ? 'decimal' : 'integer', confidence: 'medium', reason: 'Value is numeric.', uncertain: true };
    }
    // Long text (>200 chars)
    if (trimmed.length > 200) {
      return { type: 'richtext', confidence: 'medium', reason: 'Value is long text (>200 chars); mapped to richtext.', uncertain: true };
    }
    // Multi-line (possible text area)
    if (trimmed.includes('\n')) {
      return { type: 'text', confidence: 'medium', reason: 'Value contains line breaks; mapped to text.', uncertain: true };
    }
  }

  // Default to string
  return {
    type: 'string',
    confidence: 'low',
    reason: 'Could not infer type from name or value; defaulted to string. Please verify.',
    uncertain: true,
  };
}

/**
 * Sanitize a document field label to a valid Strapi attribute name.
 * e.g. "SEO Title" -> "seoTitle", "1. Title" -> "title"
 */
function toAttributeName(label: string): string {
  return label
    .replace(/^\d+[\.\)]\s*/, '')    // remove leading "1. " or "1) "
    .replace(/\[.*?\]/g, '')          // remove "[Image]"
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, ' ') // replace non-alphanumeric with space
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase()) // camelCase
    .replace(/^\s+/, '')
    || 'field';
}

/**
 * Analyze an extracted DOCX document and generate a proposed Strapi schema.
 */
export function analyzeDocumentForSchema(
  doc: ExtractedDocument,
  proposedDisplayName?: string,
  kind: 'collectionType' | 'singleType' = 'collectionType',
): ProposedSchema {
  const warnings: string[] = [];
  const unrepresentable: string[] = [];
  const inferredFields: InferredField[] = [];
  const usedNames = new Set<string>();

  function addField(
    name: string,
    value: string | null,
    overrideType?: string,
    overrideReason?: string,
  ) {
    const attrName = toAttributeName(name);
    if (!attrName || usedNames.has(attrName)) return;
    usedNames.add(attrName);

    const inferred = overrideType
      ? { type: overrideType, confidence: 'high' as const, reason: overrideReason ?? `Field "${name}" mapped to ${overrideType}.`, uncertain: false }
      : inferFieldType(name, value);

    const attr: ContentTypeAttribute = { type: inferred.type };
    if (inferred.type === 'uid' && usedNames.has('title')) {
      attr.targetField = 'title';
    }

    inferredFields.push({
      name: attrName,
      type: inferred.type,
      attributes: attr,
      sourceValue: value,
      confidence: inferred.confidence,
      reason: inferred.reason,
      uncertain: inferred.uncertain,
    });
  }

  // 1. Fields extracted from tables/labeled paragraphs
  for (const [fieldKey, value] of Object.entries(doc.parsedFields)) {
    if (value === null || value === undefined) continue;

    // Handle nested SEO fields
    if (fieldKey === 'defaultSeo' && typeof value === 'object') {
      // Represent SEO as a component — flag as uncertain
      if (!usedNames.has('seo')) {
        usedNames.add('seo');
        inferredFields.push({
          name: 'seo',
          type: 'component',
          attributes: { type: 'component', component: 'seo.seo', repeatable: false },
          sourceValue: null,
          confidence: 'medium',
          reason: 'SEO sub-fields detected; mapped to an seo component. You must create the component separately if it does not exist.',
          uncertain: true,
        });
      }
      continue;
    }

    // Handle repeatable contentNew component
    if (fieldKey === 'contentnew') {
      if (!usedNames.has('contentnew')) {
        usedNames.add('contentnew');
        inferredFields.push({
          name: 'contentnew',
          type: 'component',
          attributes: { type: 'component', component: 'component.content-new', repeatable: true },
          sourceValue: null,
          confidence: 'high',
          reason: 'Document sections mapped to repeatable contentNew component.',
          uncertain: false,
        });
      }
      continue;
    }

    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    addField(fieldKey, strValue);
  }

  // 2. Unmapped fields from the document
  for (const unmapped of doc.unmappedFields) {
    addField(unmapped.label, unmapped.value);
  }

  // 3. If title/description/content weren't already added via parsedFields, infer from document
  if (!usedNames.has('title') && doc.title) {
    addField('title', doc.title, 'string', 'Document title mapped to string.');
  }
  if (!usedNames.has('description') && doc.description) {
    addField('description', doc.description, 'text', 'Document description mapped to text.');
  }
  if (!usedNames.has('content') && doc.content) {
    addField('content', doc.content, 'richtext', 'Document body mapped to richtext.');
  }

  // 4. Images detected in the document
  if (doc.images.length > 0) {
    if (!usedNames.has('cover') && !usedNames.has('image')) {
      usedNames.add('cover');
      inferredFields.push({
        name: 'cover',
        type: 'media',
        attributes: { type: 'media', multiple: false, allowedTypes: ['images'] },
        sourceValue: null,
        confidence: 'medium',
        reason: `Document contains ${doc.images.length} embedded image(s). A cover media field was inferred.`,
        uncertain: true,
      });
    }
  }

  // 5. Lists suggest repeatable components or JSON fields
  if (doc.lists.length > 0 && doc.lists.some((l) => l.length > 2)) {
    warnings.push(
      `Document contains ${doc.lists.length} list(s) with multiple items. ` +
      'These may require repeatable component or JSON fields not automatically inferred here.'
    );
  }

  // 6. FAQ sections
  if (doc.parsedFields.faqsection) {
    unrepresentable.push(
      'FAQ section: FAQ data requires a repeatable component (e.g. "faq" with question/answer fields). Not automatically created.'
    );
  }

  // Flag component fields as requiring manual attention
  const componentFields = inferredFields.filter((f) => f.type === 'component' || f.type === 'media');
  if (componentFields.length > 0) {
    warnings.push(
      `${componentFields.length} field(s) inferred as component or media type. ` +
      'These require the referenced component or media field to exist in Strapi before use.'
    );
  }

  // Overall confidence
  const lowCount = inferredFields.filter((f) => f.confidence === 'low').length;
  const uncertainCount = inferredFields.filter((f) => f.uncertain).length;
  const confidence = lowCount > 2 || uncertainCount > inferredFields.length / 2 ? 'low'
    : uncertainCount > 0 ? 'medium'
    : 'high';

  // Proposed names
  const displayName = proposedDisplayName ?? (doc.title ? titleToDisplayName(doc.title) : 'New Content Type');
  const singularName = toSingularName(displayName);
  const pluralName = toPluralName(singularName);

  if (inferredFields.length === 0) {
    warnings.push('No fields could be inferred from this document. The document may be empty or contain only template instructions.');
  }

  return {
    displayName,
    singularName,
    pluralName,
    kind,
    draftAndPublish: true,
    fields: inferredFields,
    confidence,
    warnings,
    unrepresentable,
  };
}

function titleToDisplayName(title: string): string {
  // Take first 5 words max and title-case them
  return title
    .split(/\s+/)
    .slice(0, 5)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Convert a ProposedSchema into a ContentTypeCreatePayload ready for the API.
 * Only includes fields with supported Strapi types (no component/media without explicit override).
 */
export function proposedSchemaToCreatePayload(
  schema: ProposedSchema,
  includeUncertain = false,
): ContentTypeCreatePayload {
  const attributes: Record<string, ContentTypeAttribute> = {};

  for (const field of schema.fields) {
    if (field.uncertain && !includeUncertain) continue;
    if (field.type === 'component' || field.type === 'media') {
      // Skip unless explicitly included
      if (!includeUncertain) continue;
    }
    attributes[field.name] = { ...field.attributes };
  }

  // Always include uid if title exists and uid not explicitly defined
  if (attributes['title'] && !attributes['slug']) {
    attributes['slug'] = { type: 'uid', targetField: 'title' };
  }

  return {
    kind: schema.kind,
    info: {
      displayName: schema.displayName,
      singularName: schema.singularName,
      pluralName: schema.pluralName,
    },
    options: {
      draftAndPublish: schema.draftAndPublish,
    },
    attributes,
  };
}

/**
 * Check if an existing content type is compatible with the proposed schema.
 * Returns a compatibility score and list of missing/conflicting fields.
 */
export interface CompatibilityCheck {
  uid: string;
  displayName: string;
  score: number; // 0–100
  matchedFields: string[];
  missingFields: string[];
  conflictingFields: string[];
  compatible: boolean;
}

export function checkSchemaCompatibility(
  proposed: ProposedSchema,
  existingAttributes: Record<string, { type: string }>,
  uid: string,
  displayName: string,
): CompatibilityCheck {
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicting: string[] = [];

  for (const field of proposed.fields) {
    const existing = existingAttributes[field.name];
    if (!existing) {
      missing.push(field.name);
    } else if (existing.type === field.type || isCompatibleType(field.type, existing.type)) {
      matched.push(field.name);
    } else {
      conflicting.push(`${field.name}: proposed=${field.type}, existing=${existing.type}`);
    }
  }

  const score = proposed.fields.length === 0
    ? 0
    : Math.round((matched.length / proposed.fields.length) * 100);

  return {
    uid,
    displayName,
    score,
    matchedFields: matched,
    missingFields: missing,
    conflictingFields: conflicting,
    compatible: score >= 70 && conflicting.length === 0,
  };
}

export interface SchemaSyncDiff {
  compatibleFields: Array<{ documentField: string; schemaField: string; type: string }>;
  missingFields: InferredField[];
  conflictingFields: Array<{
    documentField: string;
    schemaField: string;
    proposedType: string;
    existingType: string;
  }>;
  unsupportedFields: Array<{ name: string; type: string; reason: string }>;
}

/**
 * Compare extracted document fields with the selected live schema. Only simple
 * scalar and explicitly inferred image fields are eligible for additive changes.
 */
export function compareDocumentSchema(
  doc: ExtractedDocument,
  collection: ImportCollection,
): SchemaSyncDiff {
  const proposal = analyzeDocumentForSchema(doc);
  const diff: SchemaSyncDiff = {
    compatibleFields: [],
    missingFields: [],
    conflictingFields: [],
    unsupportedFields: [],
  };
  const scalarTypes = new Set([
    'string', 'text', 'richtext', 'uid', 'email', 'date', 'datetime',
    'boolean', 'integer', 'float', 'decimal',
  ]);
  const compatibleTextTypes = new Set(['string', 'text', 'richtext', 'uid', 'email']);
  const compatibleNumberTypes = new Set(['integer', 'float', 'decimal', 'biginteger']);

  for (const proposed of proposal.fields) {
    const mapping = DOCUMENT_FIELD_MAPPINGS.find((entry) =>
      entry.internalField === proposed.name);
    if (mapping && !mapping.automatic &&
      (mapping.strapiField !== null || !scalarTypes.has(proposed.type))) {
      diff.unsupportedFields.push({
        name: proposed.name,
        type: proposed.type,
        reason: mapping.note ?? 'This document field requires manual structure or mapping.',
      });
      continue;
    }

    const mappedPath = mapping?.strapiField?.split('.')[0];
    const existing = collection.fields.find((field) =>
      field.name === proposed.name ||
      field.name === mappedPath ||
      field.sourceField === proposed.name);

    if (existing) {
      const nestedComponentMapping = Boolean(
        mapping?.strapiField?.includes('.') && existing.type === 'component'
      );
      const isComponentMatch = Boolean(
        existing.type === 'component' &&
        (mapping?.kind === 'component' ||
         mapping?.dataType?.includes('component') ||
         proposed.type === 'component')
      );
      const sameType = existing.type === proposed.type;
      const compatibleText = compatibleTextTypes.has(existing.type) &&
        compatibleTextTypes.has(proposed.type);
      const compatibleNumber = compatibleNumberTypes.has(existing.type) &&
        compatibleNumberTypes.has(proposed.type);
      if (nestedComponentMapping || isComponentMatch || sameType || compatibleText || compatibleNumber) {
        diff.compatibleFields.push({
          documentField: proposed.name,
          schemaField: existing.name,
          type: existing.type,
        });
      } else {
        diff.conflictingFields.push({
          documentField: proposed.name,
          schemaField: existing.name,
          proposedType: proposed.type,
          existingType: existing.type,
        });
      }
      continue;
    }

    if (!scalarTypes.has(proposed.type) && proposed.type !== 'media') {
      diff.unsupportedFields.push({
        name: proposed.name,
        type: proposed.type,
        reason: proposed.type === 'component'
          ? 'Component fields require an existing, manually verified component definition.'
          : 'This field requires manual configuration before import.',
      });
      continue;
    }

    if (proposed.type === 'media' && doc.images.length === 0) {
      diff.unsupportedFields.push({
        name: proposed.name,
        type: proposed.type,
        reason: 'No embedded image binary is available to validate this media field.',
      });
      continue;
    }

    diff.missingFields.push({
      ...proposed,
      name: mappedPath ?? proposed.name,
    });
  }

  return diff;
}

/** Check if two Strapi types are semantically compatible for import purposes */
function isCompatibleType(proposed: string, existing: string): boolean {
  const textTypes = new Set(['string', 'text', 'richtext', 'uid', 'email']);
  const numTypes = new Set(['integer', 'float', 'decimal', 'biginteger']);
  return (textTypes.has(proposed) && textTypes.has(existing)) ||
    (numTypes.has(proposed) && numTypes.has(existing));
}
