import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createConfigRouter } from '../../../server/routes/config.js';
import { ConfigParser } from '../../../lib/config-parser.js';

describe('legacy config routes with Project Profile records', () => {
    let directory;
    let configPath;
    let parser;
    let service;
    let app;
    const access = {
        organizationId: 'unson',
        role: 'gm',
        projectCodes: ['growin']
    };

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-config-legacy-'));
        configPath = path.join(directory, 'config.yml');
        const projectsRoot = path.join(directory, 'projects');
        await fs.mkdir(projectsRoot, { recursive: true });
        await fs.writeFile(configPath, yaml.dump({
            projects: [{
                id: 'growin',
                project_code: 'growin',
                name: 'Growin向けBrainbase',
                organization: 'unson',
                created_by: 'keigo',
                success_criteria: ['Slackから議事録を作成できる'],
                capabilities: {
                    slack: {
                        desired_state: 'enabled',
                        primary_channel_id: 'C123'
                    }
                },
                people: { owner: ['keigo'] },
                local: {
                    path: '${PROJECTS_ROOT:-/workspace/projects}/growin',
                    glob_include: ['server/**']
                },
                github: {
                    owner: 'Unson-LLC',
                    repo: 'growin',
                    branch: 'main'
                },
                nocodb: {
                    base_id: 'legacy-base',
                    project_id: 'nocodb-growin',
                    base_name: 'Growin'
                }
            }],
            organizations: [{ id: 'unson', name: '合同会社雲孫' }]
        }));
        parser = new ConfigParser(
            path.join(directory, 'codex'),
            configPath,
            path.join(directory, 'workspace'),
            projectsRoot
        );
        service = {
            upsertProject: vi.fn().mockResolvedValue({ id: 'legacy' }),
            deleteProject: vi.fn().mockResolvedValue(true),
            upsertGitHubMapping: vi.fn().mockResolvedValue({
                project_id: 'growin', owner: 'Unson-LLC', repo: 'growin', branch: 'main'
            }),
            deleteGitHubMapping: vi.fn().mockResolvedValue(true),
            upsertNocoDBMapping: vi.fn().mockResolvedValue({
                project_id: 'growin', project_id_external: 'nocodb-growin'
            }),
            deleteNocoDBMapping: vi.fn().mockResolvedValue(true)
        };
        app = express();
        app.use(express.json());
        const allow = (req, _res, next) => {
            req.access = access;
            next();
        };
        app.use('/api/config', createConfigRouter(parser, service, null, {
            authGuard: allow,
            writeGuard: allow
        }));
    });

    afterEach(async () => {
        await fs.rm(directory, { recursive: true, force: true });
    });

    it('keeps legacy project routes free of Project Profile tenant and intent fields', async () => {
        const response = await request(app).get('/api/config/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects).toEqual([{
            id: 'growin',
            name: 'Growin向けBrainbase',
            local: {
                path: path.join(directory, 'projects', 'growin'),
                glob_include: ['server/**']
            },
            github: {
                owner: 'Unson-LLC',
                repo: 'growin',
                branch: 'main'
            },
            nocodb: {
                base_id: 'legacy-base',
                project_id: 'nocodb-growin',
                base_name: 'Growin'
            }
        }]);
        expect(response.body.projects[0]).not.toHaveProperty('project_code');
        expect(response.body.projects[0]).not.toHaveProperty('organization');
        expect(response.body.projects[0]).not.toHaveProperty('created_by');
        expect(response.body.projects[0]).not.toHaveProperty('capabilities');
        expect(response.body.projects[0]).not.toHaveProperty('people');
        expect(response.body.projects[0]).not.toHaveProperty('success_criteria');
    });

    it('keeps GET /api/config and GitHub mapping projection compatible', async () => {
        const allResponse = await request(app).get('/api/config');
        expect(allResponse.status).toBe(200);
        for (const field of [
            'project_code', 'organization', 'created_by', 'capabilities', 'people', 'success_criteria'
        ]) {
            expect(allResponse.body.projects.projects[0]).not.toHaveProperty(field);
        }
        expect(allResponse.body.github).toEqual([{
            project_id: 'growin',
            owner: 'Unson-LLC',
            repo: 'growin',
            branch: 'main',
            url: 'https://github.com/Unson-LLC/growin'
        }]);

        const githubResponse = await request(app).get('/api/config/github');
        expect(githubResponse.status).toBe(200);
        expect(githubResponse.body).toEqual(allResponse.body.github);
    });

    it('preserves legacy project upsert payload normalization', async () => {
        const response = await request(app)
            .post('/api/config/projects')
            .send({
                id: 'legacy',
                emoji: '🧱',
                local_path: '/tmp/legacy',
                glob_include: 'src/**\n!test/**',
                archived: true
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
        expect(service.upsertProject).toHaveBeenCalledWith({
            id: 'legacy',
            emoji: '🧱',
            local_path: '/tmp/legacy',
            glob_include: ['src/**', '!test/**'],
            archived: true
        }, access);
    });

    it('passes scoped access through every legacy mapping write', async () => {
        const githubPayload = {
            project_id: 'growin',
            owner: 'Unson-LLC',
            repo: 'growin-next',
            branch: 'main'
        };
        const nocodbPayload = {
            project_id: 'growin',
            base_id: 'base-next',
            nocodb_project_id: 'nocodb-growin-next',
            base_name: 'Growin Next',
            url: 'https://nocodb.example.test'
        };

        await request(app).put('/api/config/github/growin').send(githubPayload);
        await request(app).delete('/api/config/github/growin');
        await request(app).put('/api/config/nocodb/growin').send(nocodbPayload);
        await request(app).delete('/api/config/nocodb/growin');

        expect(service.upsertGitHubMapping).toHaveBeenCalledWith(githubPayload, access);
        expect(service.deleteGitHubMapping).toHaveBeenCalledWith('growin', access);
        expect(service.upsertNocoDBMapping).toHaveBeenCalledWith(nocodbPayload, access);
        expect(service.deleteNocoDBMapping).toHaveBeenCalledWith('growin', access);
    });

    it('passes scoped access through legacy project deletion', async () => {
        const response = await request(app).delete('/api/config/projects/growin');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
        expect(service.deleteProject).toHaveBeenCalledWith('growin', access);
    });
});
