import { describe, expect, it } from 'vitest';
import {
  PROJECT_ICON_MAX_BYTES,
  projectIconSummary,
  renderProjectIcon,
  validateProjectIconDataUrl,
} from '../ui/project-icon.js';
import { FakeDocument } from './ui/graph-ui-harness.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';
const WEBP = 'data:image/webp;base64,UklGRgAAAABXRUJQ';

describe('project icon shared helper', () => {
  it.each([
    ['PNG', PNG, 'image/png', 8],
    ['JPEG', JPEG, 'image/jpeg', 4],
    ['WebP', WEBP, 'image/webp', 12],
  ])('accepts a signature checked %s data URL', (_label, value, mimeType, bytes) => {
    expect(validateProjectIconDataUrl(value)).toEqual({ ok: true, value, mimeType, bytes });
    expect(projectIconSummary(value)).toEqual({ present: true, mimeType, bytes });
  });

  it('accepts explicit removal and rejects external URLs, SVG, mismatched signatures and malformed base64', () => {
    expect(validateProjectIconDataUrl(null)).toMatchObject({ ok: true, value: null });
    expect(validateProjectIconDataUrl('')).toMatchObject({ ok: true, value: null });
    expect(projectIconSummary(null)).toBeNull();
    expect(projectIconSummary('')).toBeNull();
    for (const value of [
      'https://example.test/icon.png',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:image/jpeg;base64,iVBORw0KGgo=',
      'data:image/png;base64,iVBORw0KGgp=',
    ]) {
      expect(validateProjectIconDataUrl(value).ok).toBe(false);
      expect(projectIconSummary(value)).toBeNull();
    }
    for (const suffix of ['\n', '\r', '\r\n']) {
      const value = `${PNG}${suffix}`;
      expect(validateProjectIconDataUrl(value).ok).toBe(false);
      expect(projectIconSummary(value)).toBeNull();
    }
  });

  it('enforces the decoded byte bound rather than the data URL string length', () => {
    const bytes = new Uint8Array(PROJECT_ICON_MAX_BYTES + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const payload = btoa(binary);
    const result = validateProjectIconDataUrl(`data:image/png;base64,${payload}`);
    expect(result).toMatchObject({ ok: false, code: 'too_large' });
  });

  it('renders a compact fallback or image without putting the data URL in text content', () => {
    const doc = new FakeDocument();
    const fallback = renderProjectIcon(doc, null, 'Atlas導入', { size: 'sm' });
    expect(fallback.className).toContain('is-sm');
    expect(fallback.className).toContain('is-unregistered');
    expect(fallback.attributes['data-initial']).toBe('A');
    expect(fallback.children).toHaveLength(0);

    const registered = renderProjectIcon(doc, PNG, 'Atlas導入');
    expect(registered.className).toContain('is-registered');
    expect(registered.children).toHaveLength(1);
    expect(registered.children[0].attributes.src).toBe(PNG);
    expect(registered.children[0].textContent).toBe('');
  });
});
