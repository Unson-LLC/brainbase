#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const defaultConfigPath = path.join(repoRoot, 'config', 'infisical-targets.json');
const defaultLocalConfigPath = path.join(os.homedir(), '.brainbase', 'infisical-targets.json');

function usage() {
  return [
    'usage: resolve-infisical-target.mjs [--list] [--shell|--json] [--config <file>] [--local <file>|--no-local] <target>',
    '',
    'Resolves a non-secret Infisical target into project/env/path/auth-file metadata.',
  ].join('\n');
}

function readJsonFile(filePath, { optional = false } = {}) {
  if (!filePath) return {};
  if (!fs.existsSync(filePath)) {
    if (optional) return {};
    throw new Error(`config file not found: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid JSON in ${filePath}: ${error.message}`);
  }
}

function mergeConfig(base, override) {
  const mergedTargets = { ...(base.targets || {}) };
  for (const [name, target] of Object.entries(override.targets || {})) {
    mergedTargets[name] = {
      ...(base.targets?.[name] || {}),
      ...target,
    };
  }

  return {
    ...base,
    ...override,
    orgAuthFiles: {
      ...(base.orgAuthFiles || {}),
      ...(override.orgAuthFiles || {}),
    },
    targets: mergedTargets,
  };
}

function loadConfig({ configPath = defaultConfigPath, localConfigPath = defaultLocalConfigPath, useLocal = true } = {}) {
  const base = readJsonFile(configPath);
  if (!useLocal) return base;
  const localPath = process.env.BRAINBASE_INFISICAL_TARGETS_LOCAL || localConfigPath;
  return mergeConfig(base, readJsonFile(localPath, { optional: true }));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== ''))];
}

function expandAuthFiles(files, config, seen = new Set()) {
  const expanded = [];
  for (const item of asArray(files)) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    if (item.startsWith('@org:')) {
      const org = item.slice('@org:'.length);
      if (seen.has(item)) {
        throw new Error(`recursive auth file reference: ${item}`);
      }
      seen.add(item);
      expanded.push(...expandAuthFiles(config.orgAuthFiles?.[org] || [], config, seen));
      seen.delete(item);
      continue;
    }
    expanded.push(item);
  }
  return unique(expanded);
}

function resolveRawTarget(name, config, stack = []) {
  const raw = config.targets?.[name];
  if (!raw) throw new Error(`unknown Infisical target: ${name}`);
  if (!raw.extends) return { ...raw };
  if (stack.includes(name)) {
    throw new Error(`recursive target extends: ${[...stack, name].join(' -> ')}`);
  }
  const parent = resolveRawTarget(raw.extends, config, [...stack, name]);
  return {
    ...parent,
    ...raw,
    requiredKeys: raw.requiredKeys ?? parent.requiredKeys,
    authFiles: raw.authFiles ?? parent.authFiles,
  };
}

function resolveTarget(name, configOrOptions = {}) {
  const config = configOrOptions.targets || configOrOptions.orgAuthFiles || configOrOptions.domain
    ? configOrOptions
    : loadConfig(configOrOptions);
  const target = resolveRawTarget(name, config);
  const domain = target.domain || config.domain;
  const projectId = target.projectId || target.workspaceId;
  const env = target.env || target.environment;
  const secretPath = target.path || target.secretPath || '/';
  const org = target.org || '';
  const authFiles = expandAuthFiles(target.authFiles ?? (org ? [`@org:${org}`] : []), config);
  const requiredKeys = unique(asArray(target.requiredKeys));

  const missing = [];
  if (!domain) missing.push('domain');
  if (!projectId) missing.push('projectId');
  if (!env) missing.push('env');
  if (!secretPath) missing.push('path');
  if (missing.length > 0) {
    throw new Error(`Infisical target ${name} is missing: ${missing.join(', ')}`);
  }

  return {
    name,
    description: target.description || '',
    org,
    domain,
    projectId,
    env,
    path: secretPath,
    authFiles,
    tokenFile: target.tokenFile || '',
    requiredKeys,
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderShellAssignments(target) {
  const lines = [
    `INFISICAL_TARGET_NAME=${shellQuote(target.name)}`,
    `INFISICAL_TARGET_DESCRIPTION=${shellQuote(target.description)}`,
    `INFISICAL_TARGET_ORG=${shellQuote(target.org)}`,
    `INFISICAL_TARGET_DOMAIN=${shellQuote(target.domain)}`,
    `INFISICAL_TARGET_PROJECT_ID=${shellQuote(target.projectId)}`,
    `INFISICAL_TARGET_ENV=${shellQuote(target.env)}`,
    `INFISICAL_TARGET_PATH=${shellQuote(target.path)}`,
    `INFISICAL_TARGET_TOKEN_FILE=${shellQuote(target.tokenFile)}`,
    `INFISICAL_TARGET_AUTH_FILE_COUNT=${target.authFiles.length}`,
  ];
  target.authFiles.forEach((file, index) => {
    lines.push(`INFISICAL_TARGET_AUTH_FILE_${index + 1}=${shellQuote(file)}`);
  });
  lines.push(`INFISICAL_TARGET_REQUIRED_KEY_COUNT=${target.requiredKeys.length}`);
  target.requiredKeys.forEach((key, index) => {
    lines.push(`INFISICAL_TARGET_REQUIRED_KEY_${index + 1}=${shellQuote(key)}`);
  });
  return `${lines.join('\n')}\n`;
}

function listTargets(config) {
  return Object.keys(config.targets || {}).sort();
}

function parseArgs(argv) {
  const args = {
    mode: 'json',
    targetName: '',
    configPath: process.env.BRAINBASE_INFISICAL_TARGETS_FILE || defaultConfigPath,
    localConfigPath: defaultLocalConfigPath,
    useLocal: true,
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--shell') args.mode = 'shell';
    else if (arg === '--json') args.mode = 'json';
    else if (arg === '--list') args.list = true;
    else if (arg === '--config') args.configPath = argv[++index];
    else if (arg === '--local') {
      args.localConfigPath = argv[++index];
      args.useLocal = true;
    } else if (arg === '--no-local') args.useLocal = false;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!args.targetName) args.targetName = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const config = loadConfig(args);
    if (args.list) {
      console.log(listTargets(config).join('\n'));
      return;
    }
    if (!args.targetName) throw new Error('target is required');
    const target = resolveTarget(args.targetName, config);
    if (args.mode === 'shell') {
      process.stdout.write(renderShellAssignments(target));
      return;
    }
    console.log(JSON.stringify(target, null, 2));
  } catch (error) {
    console.error(`resolve-infisical-target: ${error.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

export {
  defaultConfigPath,
  defaultLocalConfigPath,
  expandAuthFiles,
  listTargets,
  loadConfig,
  mergeConfig,
  renderShellAssignments,
  resolveTarget,
};
