// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configMocks = vi.hoisted(() => ({
    getAuth: vi.fn(),
    getConfig: vi.fn()
}));

vi.mock('../../cli/config.js', () => configMocks);

import {
    configureProject,
    createProject,
    inspectProject,
    reconcileProject
} from '../../cli/project.js';

function jsonResponse(body, status = 200, ok = true) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body)
    };
}

describe('project profile CLI', () => {
    let directory;
    let fetchMock;
    let consoleLog;

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-project-cli-'));
        configMocks.getConfig.mockReturnValue({ server_url: 'http://config.example.test' });
        configMocks.getAuth.mockReturnValue({
            token: 'token-123',
            server_url: 'http://profiles.example.test'
        });
        fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(async () => {
        consoleLog.mockRestore();
        vi.unstubAllGlobals();
        await fs.rm(directory, { recursive: true, force: true });
    });

    it('create sends the minimal Project Profile YAML with bearer authentication', async () => {
        const input = {
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        };
        const inputPath = path.join(directory, 'project.yml');
        await fs.writeFile(inputPath, [
            'project_code: growin',
            'name: Growin向けBrainbase',
            'organization: unson',
            'created_by: keigo',
            ''
        ].join('\n'));
        const result = { ok: true, project: input };
        fetchMock.mockResolvedValue(jsonResponse(result, 201));

        await createProject([inputPath]);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://profiles.example.test/api/config/project-profiles');
        expect(options).toMatchObject({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer token-123'
            }
        });
        expect(JSON.parse(options.body)).toEqual(input);
        expect(consoleLog).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });

    it('configure sends a PUT to the encoded project code', async () => {
        const input = {
            capabilities: {
                slack: { desired_state: 'enabled', primary_channel_id: 'C123' }
            }
        };
        const inputPath = path.join(directory, 'configure.yml');
        await fs.writeFile(inputPath, [
            'capabilities:',
            '  slack:',
            '    desired_state: enabled',
            '    primary_channel_id: C123',
            ''
        ].join('\n'));
        const result = { ok: true, project: { project_code: 'ai/phone' } };
        fetchMock.mockResolvedValue(jsonResponse(result));

        await configureProject(['ai/phone', inputPath]);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://profiles.example.test/api/config/project-profiles/ai%2Fphone');
        expect(options.method).toBe('PUT');
        expect(JSON.parse(options.body)).toEqual(input);
    });

    it('inspect uses the configured fallback header mode and does not send a body', async () => {
        configMocks.getAuth.mockReturnValue({
            mode: 'insecure_header',
            role: 'gm',
            projects: ['growin', 'aitle'],
            clearance: ['read', 'write'],
            server_url: 'http://profiles.example.test'
        });
        const result = { project_code: 'growin', project: 'registered' };
        fetchMock.mockResolvedValue(jsonResponse(result));

        await inspectProject(['growin']);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://profiles.example.test/api/config/project-profiles/growin/inspect');
        expect(options).toMatchObject({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-brainbase-role': 'gm',
                'x-brainbase-projects': 'growin,aitle',
                'x-brainbase-clearance': 'read,write'
            }
        });
        expect(options).not.toHaveProperty('body');
        expect(consoleLog).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });

    it('reconcile sends candidate YAML to the project endpoint', async () => {
        const input = {
            people_candidates: [
                { person_id: 'kuramoto', action: 'defer' }
            ]
        };
        const inputPath = path.join(directory, 'candidates.yml');
        await fs.writeFile(inputPath, [
            'people_candidates:',
            '  - person_id: kuramoto',
            '    action: defer',
            ''
        ].join('\n'));
        const result = { project_code: 'growin', candidates: input.people_candidates };
        fetchMock.mockResolvedValue(jsonResponse(result));

        await reconcileProject(['growin', inputPath]);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://profiles.example.test/api/config/project-profiles/growin/reconcile');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual(input);
    });

    it('rejects a YAML sequence where a Project Profile object is required', async () => {
        const inputPath = path.join(directory, 'invalid.yml');
        await fs.writeFile(inputPath, '- not-a-project-object\n');

        await expect(createProject([inputPath])).rejects.toThrow(
            'Project登録情報はYAMLオブジェクトである必要があります'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed YAML before making a request', async () => {
        const inputPath = path.join(directory, 'malformed.yml');
        await fs.writeFile(inputPath, 'project_code: [unterminated\n');

        await expect(createProject([inputPath])).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a missing YAML file in Japanese', async () => {
        const inputPath = path.join(directory, 'missing.yml');

        await expect(createProject([inputPath])).rejects.toThrow(
            `Project登録情報のYAMLファイルが見つかりません: ${inputPath}`
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports missing command arguments in Japanese', async () => {
        await expect(configureProject([])).rejects.toThrow('使い方: brainbase project configure');
        await expect(inspectProject([])).rejects.toThrow('使い方: brainbase project inspect');
        await expect(reconcileProject([])).rejects.toThrow('使い方: brainbase project reconcile');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a structured non-2xx API error', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            error: { code: 'FORBIDDEN', message: 'Project profile is outside the tenant' }
        }, 403, false));

        await expect(inspectProject(['growin'])).rejects.toThrow(
            '[FORBIDDEN] HTTP 403: Project profile is outside the tenant'
        );
    });

    it('requires authentication before making a request', async () => {
        configMocks.getAuth.mockReturnValue(null);

        await expect(inspectProject(['growin'])).rejects.toThrow(
            'ログインが必要です: brainbase auth login'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
