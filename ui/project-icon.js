/*
 * Project icon validation and rendering shared by the local and organization
 * Graph screens.
 *
 * Icons are deliberately kept as bounded data URLs.  The Graph correction
 * endpoint stores the value in the project metadata, while this module keeps
 * the browser side independent from Node's Buffer implementation so the
 * organization edition can consume the same helper.
 */

export const PROJECT_ICON_MAX_BYTES = 256 * 1024;
export const PROJECT_ICON_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

const MIME_LABELS = Object.freeze({
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
});

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})(?![\s\S])/u;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A compact representation safe to put in correction history or audit UI. */
export function projectIconSummary(value) {
  const result = validateProjectIconDataUrl(value);
  if (!result.ok || result.value === null) return null;
  return { present: true, mimeType: result.mimeType, bytes: result.bytes };
}

/**
 * Checks a project icon data URL, including the decoded byte limit and the
 * file signature.  `null` means an explicit removal and is valid for a
 * correction; callers can distinguish it from an invalid non-null value.
 */
export function validateProjectIconDataUrl(value, { maxBytes = PROJECT_ICON_MAX_BYTES } = {}) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null, mimeType: null, bytes: 0 };
  if (typeof value !== 'string') return invalidIcon('type', 'アイコンはPNG、JPEG、WebPの画像を選んでください。');
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return invalidIcon('format', 'アイコンはPNG、JPEG、WebPの画像を選んでください。');
  const [, mimeType, payload] = match;
  if (!isCanonicalBase64(payload)) return invalidIcon('base64', 'アイコンの画像データを読み取れません。もう一度選んでください。');
  const bytes = decodedLength(payload);
  if (bytes === 0) return invalidIcon('empty', '空の画像は登録できません。');
  if (bytes > maxBytes) return invalidIcon('too_large', `アイコンは${Math.floor(maxBytes / 1024)}KiB以下にしてください。`);
  if (!matchesSignature(mimeType, payload, bytes)) return invalidIcon('signature', '画像形式とデータが一致しません。もう一度選んでください。');
  return { ok: true, value, mimeType, bytes };
}

/** Human-readable type for a validated icon summary. */
export function projectIconMimeLabel(mimeType) {
  return MIME_LABELS[mimeType] ?? '画像';
}

/** A stable fallback mark for an unregistered project icon. */
export function projectIconInitial(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  return [...text][0]?.toUpperCase() ?? 'P';
}

/**
 * Render an icon without putting the data URL into text content.  Fallback
 * initials are drawn by CSS from `data-initial`, which keeps ledger accessible
 * names and existing screen-reader text compact.
 */
export function renderProjectIcon(doc, value, name, { size = 'md' } = {}) {
  const valid = validateProjectIconDataUrl(value);
  const registered = valid.ok && valid.value;
  const label = `${typeof name === 'string' && name.trim() ? name.trim() : 'プロジェクト'}のアイコン`;
  const icon = doc.createElement('span');
  icon.className = `bb-project-icon is-${size}${registered ? ' is-registered' : ' is-unregistered'}`;
  icon.setAttribute('aria-label', registered ? label : `${label}（未登録）`);
  icon.setAttribute('title', registered ? label : `${label}（未登録）`);
  icon.setAttribute('data-state', registered ? 'registered' : 'unregistered');
  if (registered) {
    const image = doc.createElement('img');
    image.setAttribute('src', value);
    image.setAttribute('alt', '');
    image.setAttribute('aria-hidden', 'true');
    icon.append(image);
  } else {
    icon.setAttribute('data-initial', projectIconInitial(name));
  }
  return icon;
}

/** Reads a browser File as a data URL; validation is left to the caller. */
export function readProjectIconFile(file) {
  if (!file) return Promise.reject(new Error('icon_file_required'));
  const Reader = globalThis.FileReader;
  if (typeof Reader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.addEventListener?.('error', () => reject(new Error('icon_file_read_failed')));
      reader.onerror = () => reject(new Error('icon_file_read_failed'));
      reader.onload = () => {
        if (typeof reader.result !== 'string') reject(new Error('icon_file_read_failed'));
        else resolve(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }
  if (typeof file.arrayBuffer === 'function' && typeof globalThis.btoa === 'function') {
    return file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const mimeType = typeof file.type === 'string' && file.type ? file.type : 'application/octet-stream';
      return `data:${mimeType};base64,${globalThis.btoa(binary)}`;
    });
  }
  return Promise.reject(new Error('icon_file_reader_unavailable'));
}

function invalidIcon(code, message) {
  return { ok: false, code, message };
}

function isCanonicalBase64(value) {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const meaningful = value.length - padding;
  if (meaningful === 0) return false;
  const last = BASE64_ALPHABET.indexOf(value[meaningful - 1]);
  if (last < 0) return false;
  if (padding === 1 && (last & 0x03) !== 0) return false;
  if (padding === 2 && (last & 0x0f) !== 0) return false;
  return true;
}

function decodedLength(value) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function base64Byte(value, index) {
  const group = Math.floor(index / 3) * 4;
  const a = BASE64_ALPHABET.indexOf(value[group]);
  const b = BASE64_ALPHABET.indexOf(value[group + 1]);
  const c = value[group + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[group + 2]);
  const d = value[group + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[group + 3]);
  const first = (a << 2) | (b >> 4);
  const second = ((b & 0x0f) << 4) | (c >> 2);
  const third = ((c & 0x03) << 6) | d;
  const offset = index % 3;
  return offset === 0 ? first : offset === 1 ? second : third;
}

function matchesSignature(mimeType, payload, bytes) {
  if (mimeType === 'image/png') return bytes >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => base64Byte(payload, index) === byte);
  if (mimeType === 'image/jpeg') return bytes >= 4 && base64Byte(payload, 0) === 0xff && base64Byte(payload, 1) === 0xd8 && base64Byte(payload, 2) === 0xff
    && base64Byte(payload, bytes - 2) === 0xff && base64Byte(payload, bytes - 1) === 0xd9;
  return bytes >= 12 && base64Byte(payload, 0) === 0x52 && base64Byte(payload, 1) === 0x49 && base64Byte(payload, 2) === 0x46 && base64Byte(payload, 3) === 0x46
    && base64Byte(payload, 8) === 0x57 && base64Byte(payload, 9) === 0x45 && base64Byte(payload, 10) === 0x42 && base64Byte(payload, 11) === 0x50;
}
