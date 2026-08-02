#!/usr/bin/env node

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CONNECTOR_TYPES = new Set([
  'mcp',
  'google_drive',
  'gmail',
  'local_folder',
  'single_document',
]);
const READINESS_STATES = new Set([
  'ready',
  'waiting_for_authorization',
  'unavailable',
  'error',
  'unconfirmed',
]);
const READY_AUTHORIZATION_STATES = new Set(['authorized', 'permitted', 'not_required']);
const AUTHORIZATION_STATES = new Set([
  ...READY_AUTHORIZATION_STATES,
  'pending',
  'denied',
  'error',
  'unconfirmed',
]);
const SCOPE_FIELDS = new Set([
  'account_id',
  'date_range',
  'drive_id',
  'file_type',
  'file_type_allowlist',
  'folder_id',
  'label',
  'project_id',
  'query',
  'resource_id',
  'root',
  'scope_ref',
  'server_id',
]);
const ARRAY_SCOPE_FIELDS = new Set(['file_type_allowlist']);
const SOURCE_FIELDS = new Set([
  'source_id',
  'source_system',
  'connector_type',
  'readiness',
  'authorization_status',
  'available_scopes',
  'health_checked_at',
  'evidence_ref',
]);
const PROVIDER_SCOPE_FIELDS = {
  mcp: new Set(['server_id', 'resource_id', 'project_id', 'scope_ref']),
  google_drive: new Set(['account_id', 'folder_id', 'drive_id', 'file_type', 'file_type_allowlist', 'scope_ref']),
  gmail: new Set(['account_id', 'query', 'label', 'date_range', 'scope_ref']),
  local_folder: new Set(['root', 'file_type', 'file_type_allowlist', 'scope_ref']),
  single_document: new Set(['resource_id', 'file_type', 'scope_ref']),
};
const SCOPE_RULES = {
  mcp: (scope) => hasText(scope.server_id)
    && ['resource_id', 'project_id', 'scope_ref'].some((key) => hasText(scope[key])),
  google_drive: (scope) => hasText(scope.account_id)
    && ['folder_id', 'drive_id', 'scope_ref'].some((key) => hasText(scope[key])),
  gmail: (scope) => hasText(scope.account_id)
    && ['query', 'label', 'date_range', 'scope_ref'].some((key) => hasText(scope[key])),
  local_folder: (scope) => hasText(scope.root),
  single_document: (scope) => ['resource_id', 'scope_ref'].some((key) => hasText(scope[key])),
};
const PROVIDER_AUTHORIZATION_STATES = {
  mcp: new Set(['authorized', 'permitted', 'not_required']),
  google_drive: new Set(['authorized']),
  gmail: new Set(['authorized']),
  local_folder: new Set(['permitted', 'not_required']),
  single_document: new Set(['permitted', 'not_required']),
};
const NON_READY_AUTHORIZATION_STATES = new Set(['pending', 'denied', 'error', 'unconfirmed']);
const EVIDENCE_URI_SCHEMES = new Set(['http:', 'https:', 'connector:', 'mcp:', 'file:']);
const HEALTH_CHECK_MAX_AGE_MS = 15 * 60 * 1000;
const HEALTH_CHECK_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_SECRET_CANONICALIZATION_PASSES = 8;
const SENSITIVE_VALUE = /(access[_-]?token|refresh[_-]?token|api[_-]?key|credential|password|secret|bearer\s+|(?:^|[^a-z0-9])['"]?[a-z0-9_-]*token['"]?\s*[:=]\s*[^\s&#;,}]+|(?:authorization\s*:\s*)?token\s+[^\s,;]+|gh[pousr]_[a-z0-9]{8,}|akia[0-9a-z]{12,}|aiza[0-9a-z_-]{16,}|xox[baprs]-[a-z0-9-]{8,})/i;
const CREDENTIAL_MATERIAL = [
  /(?:[a-z][a-z0-9+.-]*:)?\/\/[^/\s:@]+(?::[^/\s@]*)?@/i,
  /(?:^|[\s;,{'"])["']?(?:[a-z0-9_-]+-)?authorization["']?\s*[:=]\s*["']?[a-z][a-z0-9_-]*\s+\S+/i,
  /(?:^|[\s;,{'"])["']?(?:cookie|set-cookie)["']?\s*[:=]\s*["']?\S+/i,
  /(?:^|[?&;\s,{'"])["']?(?:[a-z0-9_.-]*session[a-z0-9_.-]*|[a-z0-9_.-]*sessid|connect\.sid|sid|jwt)(?:["']|(?:\[[^\]]+\])*)?\s*[:=]\s*["']?[^\s&#;,}]+/i,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
];
const CREDENTIAL_FIELD = /^(?:(?:proxy|x)-)?authorization$|^(?:set-)?cookie$|(?:session|sessid)|^(?:sid|jwt)$/i;

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function decodeCharacterEscapes(value) {
  return value
    .replace(/&(amp|colon|equals|commat|quot|apos|sol);/gi, (match, entity) => ({
      amp: '&',
      colon: ':',
      equals: '=',
      commat: '@',
      quot: '"',
      apos: "'",
      sol: '/',
    })[entity.toLowerCase()] ?? match)
    .replace(/\\(["'\\/])/g, '$1')
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (match, braced, unicode, hex) => {
      const codePoint = Number.parseInt(braced ?? unicode ?? hex, 16);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&#x([0-9a-f]{1,6});|&#([0-9]{1,7});/gi, (match, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    });
}

function containsStructuredCredential(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    if (typeof value[0] === 'string' && CREDENTIAL_FIELD.test(value[0]) && value.length > 1) return true;
    return value.some((item) => containsStructuredCredential(item, seen));
  }
  return Object.entries(value).some(([key, nested]) => (
    CREDENTIAL_FIELD.test(key) && nested != null && nested !== ''
  ) || containsStructuredCredential(nested, seen));
}

function looksLikeCompactJwt(value) {
  const candidates = value.match(/(?:^|[^A-Za-z0-9_=-])([A-Za-z0-9_-]+={0,2})\.([A-Za-z0-9_-]*={0,2})\.([A-Za-z0-9_-]+={0,2})(?=$|[^A-Za-z0-9_=-])/g) ?? [];
  return candidates.some((candidate) => {
    const compact = candidate.replace(/^[^A-Za-z0-9_-]/, '');
    const [encodedHeader] = compact.split('.');
    try {
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
      return header && typeof header === 'object' && (hasText(header.alg) || header.typ === 'JWT');
    } catch {
      return false;
    }
  });
}

function containsSensitiveText(value) {
  if (typeof value !== 'string') return false;
  let candidate = value;
  for (let index = 0; index < MAX_SECRET_CANONICALIZATION_PASSES; index += 1) {
    let structuredCredential = false;
    try {
      structuredCredential = containsStructuredCredential(JSON.parse(candidate));
    } catch {
      // Non-JSON scope strings continue through the textual checks.
    }
    if (SENSITIVE_VALUE.test(candidate)
      || CREDENTIAL_MATERIAL.some((pattern) => pattern.test(candidate))
      || structuredCredential
      || looksLikeCompactJwt(candidate)) {
      return true;
    }
    const characterDecoded = decodeCharacterEscapes(candidate);
    if (/%(?![0-9a-f]{2})/i.test(characterDecoded)) return true;
    try {
      const decoded = decodeURIComponent(characterDecoded);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return true;
}

function isSafeText(value) {
  return hasText(value) && !containsSensitiveText(value);
}

function isRecentHealthCheckTimestamp(value) {
  if (!hasText(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(timestamp)
    || timestamp < now - HEALTH_CHECK_MAX_AGE_MS
    || timestamp > now + HEALTH_CHECK_FUTURE_SKEW_MS) return false;
  const canonical = new Date(timestamp).toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value;
}

function containsSensitiveValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return containsSensitiveText(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, nested]) => containsSensitiveText(key) || containsSensitiveValue(nested, seen),
  );
}

function isSafeIdentifier(value) {
  return isSafeText(value) && /^[A-Za-z0-9._:@/-]{1,256}$/.test(value);
}

function isValidScopeText(key, value) {
  if (!isSafeText(value)) return false;
  if (key !== 'date_range') return true;
  const match = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match) return false;
  return isCalendarDate(match[1]) && isCalendarDate(match[2]) && match[1] <= match[2];
}

function isCalendarDate(value) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isEvidenceReference(value) {
  if (!isSafeText(value) || /\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return EVIDENCE_URI_SCHEMES.has(parsed.protocol)
        && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch {
      return false;
    }
  }
  return /^[A-Za-z0-9._/-]+$/.test(value);
}

function hasConnectorScope(connectorType, scopes) {
  const allowedFields = PROVIDER_SCOPE_FIELDS[connectorType];
  const requiredRule = SCOPE_RULES[connectorType];
  return Boolean(allowedFields && requiredRule) && scopes.every(
    (scope) => Object.keys(scope).every((key) => allowedFields.has(key)) && requiredRule(scope),
  );
}

function sanitizeScopes(scopes) {
  if (!Array.isArray(scopes)) return { scopes: [], invalid: true, sensitive: false };
  let invalid = false;
  let sensitive = false;
  const sanitized = scopes.map((scope) => {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
      invalid = true;
      return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(scope)) {
      if (!SCOPE_FIELDS.has(key)) {
        invalid = true;
        if (containsSensitiveText(key) || containsSensitiveText(value)) {
          sensitive = true;
        }
        continue;
      }
      if (ARRAY_SCOPE_FIELDS.has(key)) {
        if (!Array.isArray(value) || value.length === 0 || !value.every(isSafeText)) {
          invalid = true;
          if (containsSensitiveText(JSON.stringify(value) ?? '')) sensitive = true;
          continue;
        }
        result[key] = value.map((item) => item.trim());
        continue;
      }
      if (!isValidScopeText(key, value)) {
        invalid = true;
        if (typeof value !== 'string' || containsSensitiveText(value)) sensitive = true;
        continue;
      }
      result[key] = value.trim();
    }
    return result;
  });
  return { scopes: sanitized, invalid, sensitive };
}

function normalizeSource(source, index, inheritedIssues = []) {
  const issues = [...inheritedIssues];
  const sanitizedScopes = sanitizeScopes(source?.available_scopes);
  const availableScopes = sanitizedScopes.scopes.filter(
    (scope) => Object.keys(scope).length > 0,
  );
  const sourceId = isSafeIdentifier(source?.source_id)
    ? source.source_id.trim()
    : `unidentified-${index + 1}`;
  const connectorType = CONNECTOR_TYPES.has(source?.connector_type)
    ? source.connector_type
    : 'unknown';
  let readiness = READINESS_STATES.has(source?.readiness) ? source.readiness : 'unconfirmed';
  const declaredReady = source?.readiness === 'ready';

  if (!hasText(source?.source_id)) issues.push('missing_source_id');
  else if (!isSafeIdentifier(source?.source_id)) issues.push('invalid_source_id');
  if (!isSafeIdentifier(source?.source_system)) issues.push('invalid_source_system');
  if (source && typeof source === 'object' && !Array.isArray(source)
    && Object.keys(source).some((key) => !SOURCE_FIELDS.has(key))) {
    issues.push('unknown_source_field');
  }
  if (connectorType === 'unknown') issues.push('unsupported_connector_type');
  if (!READINESS_STATES.has(source?.readiness)) issues.push('invalid_readiness');
  if (!AUTHORIZATION_STATES.has(source?.authorization_status)) {
    issues.push('invalid_authorization_status');
  } else if (!NON_READY_AUTHORIZATION_STATES.has(source.authorization_status)
    && !PROVIDER_AUTHORIZATION_STATES[connectorType]?.has(source.authorization_status)) {
    issues.push('invalid_provider_authorization_status');
  }
  if (source?.health_checked_at != null
    && !isRecentHealthCheckTimestamp(source.health_checked_at)) {
    issues.push('invalid_health_check');
  }
  if (source?.evidence_ref != null && !isEvidenceReference(source.evidence_ref)) {
    issues.push('invalid_evidence_ref');
  }
  if (sanitizedScopes.invalid) issues.push('invalid_scope_value');
  if (sanitizedScopes.sensitive) issues.push('sensitive_scope_value_removed');
  if (containsSensitiveValue(source) && !sanitizedScopes.sensitive) {
    issues.push('sensitive_input_value_removed');
  }
  if (availableScopes.length > 0 && connectorType !== 'unknown'
    && !hasConnectorScope(connectorType, availableScopes)) {
    issues.push('invalid_connector_scope');
  }

  if (declaredReady) {
    if (!READY_AUTHORIZATION_STATES.has(source?.authorization_status)
      || !PROVIDER_AUTHORIZATION_STATES[connectorType]?.has(source?.authorization_status)) {
      issues.push('ready_without_authorization_evidence');
    }
    if (availableScopes.length === 0) {
      issues.push('ready_without_available_scope');
    } else if (!hasConnectorScope(connectorType, availableScopes)) {
      issues.push('ready_without_connector_scope');
    }
    if (!isRecentHealthCheckTimestamp(source?.health_checked_at)) issues.push('ready_without_valid_health_check');
    if (!isEvidenceReference(source?.evidence_ref)) issues.push('ready_without_valid_evidence_ref');

  }

  if (issues.length > 0) readiness = 'unconfirmed';

  return {
    source_id: sourceId,
    source_system: isSafeIdentifier(source?.source_system) ? source.source_system.trim() : connectorType,
    connector_type: connectorType,
    readiness,
    declared_readiness: READINESS_STATES.has(source?.readiness) ? source.readiness : 'unconfirmed',
    authorization_status: AUTHORIZATION_STATES.has(source?.authorization_status)
      ? source.authorization_status.trim()
      : 'unconfirmed',
    available_scopes: availableScopes,
    health_checked_at: isRecentHealthCheckTimestamp(source?.health_checked_at)
      ? source.health_checked_at.trim()
      : null,
    evidence_ref: isEvidenceReference(source?.evidence_ref) ? source.evidence_ref.trim() : null,
    issues,
  };
}

function normalizeOnboardingSourceInventoryWithIssues(sources, inheritedIssues = []) {
  if (!Array.isArray(sources)) {
    throw new TypeError('source inventory must be an array');
  }

  const normalized = sources.map((source, index) => normalizeSource(source, index, inheritedIssues));
  const sourceIdCounts = new Map();
  for (const source of normalized) {
    sourceIdCounts.set(source.source_id, (sourceIdCounts.get(source.source_id) ?? 0) + 1);
  }
  for (const source of normalized) {
    if ((sourceIdCounts.get(source.source_id) ?? 0) > 1) {
      source.issues.push('duplicate_source_id');
      source.readiness = 'unconfirmed';
    }
  }
  const readySources = normalized.filter((source) => source.readiness === 'ready');
  const primaryReady = readySources.filter((source) => source.connector_type !== 'single_document');
  const fallbackReady = readySources.filter((source) => source.connector_type === 'single_document');
  const recommended = primaryReady.length > 0 ? primaryReady : fallbackReady;
  const issues = normalized.flatMap((source) =>
    source.issues.map((issue) => ({ source_id: source.source_id, issue })),
  );
  if (normalized.length === 0) {
    issues.push(...inheritedIssues.map((issue) => ({ source_id: null, issue })));
  }

  return {
    ready_sources: readySources,
    waiting_for_authorization: normalized.filter(
      (source) => source.readiness === 'waiting_for_authorization',
    ),
    unavailable_sources: normalized.filter((source) => source.readiness === 'unavailable'),
    failed_sources: normalized.filter((source) => source.readiness === 'error'),
    unconfirmed_sources: normalized.filter((source) => source.readiness === 'unconfirmed'),
    recommended_source_ids: recommended.map((source) => source.source_id),
    fallback_available: fallbackReady.length > 0,
    can_start_warm_path: primaryReady.length > 0,
    can_start_fallback_path: primaryReady.length === 0 && fallbackReady.length > 0,
    can_start_onboarding: recommended.length > 0,
    issues,
  };
}

export function normalizeOnboardingSourceInventory(sources) {
  return normalizeOnboardingSourceInventoryWithIssues(sources);
}

export function normalizeOnboardingSourceInventoryInput(input) {
  if (Array.isArray(input)) return normalizeOnboardingSourceInventory(input);
  if (!input || typeof input !== 'object' || Array.isArray(input.sources) === false) {
    throw new TypeError('source inventory input must be an array or an object with a sources array');
  }

  const unknownWrapperFields = Object.keys(input).filter((key) => key !== 'sources');
  const wrapperIssues = [];
  if (unknownWrapperFields.length > 0) wrapperIssues.push('unknown_inventory_wrapper_field');
  if (containsSensitiveValue(Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'sources'),
  ))) {
    wrapperIssues.push('sensitive_inventory_wrapper_value_removed');
  }
  return normalizeOnboardingSourceInventoryWithIssues(input.sources, wrapperIssues);
}

async function readInput(inputPath) {
  if (inputPath && inputPath !== '-') return fs.readFile(inputPath, 'utf8');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.join('');
}

async function main() {
  const raw = await readInput(process.argv[2]);
  const parsed = JSON.parse(raw);
  process.stdout.write(`${JSON.stringify(normalizeOnboardingSourceInventoryInput(parsed), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`onboarding source inventory error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
