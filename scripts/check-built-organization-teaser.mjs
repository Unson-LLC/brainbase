#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const dist = join(root, 'docs/.vitepress/dist');

async function read(relativePath) {
  return readFile(join(dist, relativePath), 'utf8');
}

function requireText(text, expected, path) {
  if (!text.includes(expected)) {
    throw new Error(`${path} must contain: ${expected}`);
  }
}

const teaser = JSON.parse(
  await readFile(join(root, 'docs/publication/organization-teaser.json'), 'utf8')
);
const index = await read('index.html');
const organization = await read('organization.html');

for (const [path, html] of [
  ['index.html', index],
  ['organization.html', organization]
]) {
  requireText(html, teaser.copy.headline, path);
  requireText(html, teaser.copy.cta, path);
  requireText(html, teaser.form.endpoint, path);
  requireText(html, 'name="_replyto"', path);
  requireText(html, teaser.form.privacy_url, path);
}

process.stdout.write(`${JSON.stringify({
  status: 'built_organization_teaser_valid',
  pages: ['index.html', 'organization.html'],
  visible_fields: 1
}, null, 2)}\n`);
