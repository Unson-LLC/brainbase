#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf8');
}

function requireText(text, expected, path) {
  if (!text.includes(expected)) {
    throw new Error(`${path} must contain: ${expected}`);
  }
}

function requireExact(value, expected, path) {
  if (value !== expected) {
    throw new Error(`${path} must equal ${expected}`);
  }
}

const teaser = JSON.parse(await read('docs/publication/organization-teaser.json'));
const component = await read('docs/.vitepress/theme/OrganizationWaitlist.vue');
const layout = await read('docs/.vitepress/theme/Layout.vue');
const theme = await read('docs/.vitepress/theme/index.js');
const organizationPage = await read('docs/manual/organization.md');
const config = await read('docs/.vitepress/config.mjs');

requireExact(teaser.schema_version, '1.0.0', 'organization teaser schema_version');
requireExact(teaser.status, 'approved', 'organization teaser status');
requireExact(teaser.approval?.status, 'approved', 'organization teaser approval.status');
requireExact(teaser.form?.provider, 'formspree', 'organization teaser form.provider');
requireExact(
  teaser.form?.endpoint,
  'https://formspree.io/f/xdkgavwn',
  'organization teaser form.endpoint'
);
requireExact(
  teaser.form?.privacy_url,
  'https://www.unson.jp/privacy-policy',
  'organization teaser form.privacy_url'
);

for (const key of [
  'eyebrow',
  'tension',
  'headline',
  'definition',
  'standard_case',
  'exception_case',
  'availability',
  'email_label',
  'cta',
  'success',
  'error',
  'privacy_note'
]) {
  if (typeof teaser.copy?.[key] !== 'string' || teaser.copy[key].trim() === '') {
    throw new Error(`organization teaser copy.${key} must be a non-empty string`);
  }
}

requireText(theme, "app.component('OrganizationWaitlist'", 'docs/.vitepress/theme/index.js');
requireText(layout, '<OrganizationWaitlist source="home" compact />', 'docs/.vitepress/theme/Layout.vue');
requireText(organizationPage, '<OrganizationWaitlist source="organization" />', 'docs/manual/organization.md');
requireText(config, "{ text: '組織版', link: '/organization' }", 'docs/.vitepress/config.mjs');

requireText(component, 'name="_replyto"', 'docs/.vitepress/theme/OrganizationWaitlist.vue');
requireText(component, 'type="email"', 'docs/.vitepress/theme/OrganizationWaitlist.vue');
requireText(component, 'name="_gotcha"', 'docs/.vitepress/theme/OrganizationWaitlist.vue');
requireText(component, "Accept: 'application/json'", 'docs/.vitepress/theme/OrganizationWaitlist.vue');
requireText(component, "'utm_source'", 'docs/.vitepress/theme/OrganizationWaitlist.vue');
requireText(component, 'teaser.form.privacy_url', 'docs/.vitepress/theme/OrganizationWaitlist.vue');

const visibleControls = [...component.matchAll(/<input\b[^>]*>/g)]
  .map((match) => match[0])
  .filter((input) => !/type="hidden"/.test(input))
  .filter((input) => !/name="_gotcha"/.test(input));

if (visibleControls.length !== 1 || !/type="email"/.test(visibleControls[0])) {
  throw new Error('Organization waitlist must expose exactly one visible email input');
}

process.stdout.write(`${JSON.stringify({
  status: 'organization_teaser_valid',
  candidate_id: teaser.candidate_id,
  visible_fields: 1,
  form_provider: teaser.form.provider
}, null, 2)}\n`);
