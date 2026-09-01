import fs from 'fs/promises';
import yaml from 'js-yaml';
import { getAuth, getConfig } from './config.js';

function getHeaders(auth) {
    if (auth.mode === 'insecure_header') {
        return {
            'Content-Type': 'application/json',
            'x-brainbase-role': auth.role,
            'x-brainbase-projects': (auth.projects || []).join(','),
            'x-brainbase-clearance': (auth.clearance || []).join(',')
        };
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`
    };
}

async function readYaml(filePath, label) {
    if (!filePath) throw new Error(`${label}のYAMLファイルを指定してください`);
    let source;
    try {
        source = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`${label}のYAMLファイルが見つかりません: ${filePath}`);
        }
        throw error;
    }
    const value = yaml.load(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label}はYAMLオブジェクトである必要があります`);
    }
    return value;
}

async function requestProject(path, { method = 'GET', body } = {}) {
    const config = getConfig();
    const auth = getAuth();
    if (!auth) throw new Error('ログインが必要です: brainbase auth login');
    const serverUrl = auth.server_url || config.server_url;
    const response = await fetch(`${serverUrl}${path}`, {
        method,
        headers: getHeaders(auth),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = result.error || {};
        const code = typeof error === 'object' ? error.code : null;
        const message = (typeof error === 'object' ? error.message : error)
            || `サーバーが ${response.status} を返しました`;
        throw new Error(`${code ? `[${code}] ` : ''}HTTP ${response.status}: ${message}`);
    }
    return result;
}

export async function createProject(args) {
    const input = await readYaml(args[0], 'Project登録情報');
    const result = await requestProject('/api/config/project-profiles', {
        method: 'POST',
        body: input
    });
    console.log(JSON.stringify(result, null, 2));
}

export async function configureProject(args) {
    const projectCode = args[0];
    if (!projectCode) throw new Error('使い方: brainbase project configure <project-code> <config.yml>');
    const input = await readYaml(args[1], 'Project構成情報');
    const result = await requestProject(`/api/config/project-profiles/${encodeURIComponent(projectCode)}`, {
        method: 'PUT',
        body: input
    });
    console.log(JSON.stringify(result, null, 2));
}

export async function inspectProject(args) {
    const projectCode = args[0];
    if (!projectCode) throw new Error('使い方: brainbase project inspect <project-code>');
    const result = await requestProject(
        `/api/config/project-profiles/${encodeURIComponent(projectCode)}/inspect`
    );
    console.log(JSON.stringify(result, null, 2));
}

export async function reconcileProject(args) {
    const projectCode = args[0];
    if (!projectCode) throw new Error('使い方: brainbase project reconcile <project-code> <candidates.yml>');
    const input = await readYaml(args[1], '関係者候補');
    const result = await requestProject(
        `/api/config/project-profiles/${encodeURIComponent(projectCode)}/reconcile`,
        { method: 'POST', body: input }
    );
    console.log(JSON.stringify(result, null, 2));
}
