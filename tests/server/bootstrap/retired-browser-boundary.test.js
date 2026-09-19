import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerStaticRoutes } from '../../../server/bootstrap/static-routes.js';
import yaml from 'js-yaml';

const publicDir = path.join(process.cwd(), 'public');
const retiredModules = [
    'modules/domain/session/session-service.js',
    'modules/domain/session/session-display-route.js',
    'modules/session-ui-state.js',
    'modules/state-api.js',
    'modules/core/session-activity-ws-client.js',
    'modules/core/terminal-transport-client.js',
    'modules/app/terminal-input-ux-mixin.js',
    'modules/app/event-listeners-mixin.js',
    'modules/app/terminal-display-mixin.js',
    'modules/app/terminal-mobile-mixin.js',
    'modules/app/ui-setup-mixin.js',
    'modules/app/session-management-mixin.js',
    'modules/domain/live-feed/live-feed-service.js',
    'modules/session-indicators.js',
    'modules/settings/settings-core.js',
    'modules/terminal/terminal-reconnect-manager.js',
    'modules/ui/views/session-context-bar-view.js'
];

describe('retired browser session and terminal boundary', () => {
    it('does not instruct operators to restore the retired session state', () => {
        const restore = readFileSync('.claude/skills/session-restore/SKILL.md', 'utf8');
        const operations = readFileSync('.claude/skills/brainbase-ops-guide/SKILL.md', 'utf8');
        const terminal = readFileSync('.claude/skills/ttyd-websocket-troubleshooting/SKILL.md', 'utf8');
        expect(terminal).not.toContain('/api/sessions/');
        for (const document of [restore, operations, terminal]) {
            expect(document).toContain('ADR-019');
            expect(document).not.toMatch(/jq\s+['"]\.sessions|export BRAINBASE_SESSION_ID|セッション状態の正.*SQLite/);
        }
    });

    it.each(retiredModules)('does not retain or serve %s', async relativePath => {
        expect(existsSync(path.join(publicDir, relativePath))).toBe(false);
        const app = express();
        registerStaticRoutes(app, { publicDir });
        await request(app).get(`/${relativePath}`).expect(404);
    });

    it('still serves the real device authentication page and its controller', async () => {
        const app = express();
        registerStaticRoutes(app, { publicDir });
        const device = await request(app).get('/device').expect(200);
        expect(device.text).toContain('/modules/device/device-auth-controller.js');
        const controller = await request(app)
            .get('/modules/device/device-auth-controller.js?v=7').expect(200);
        expect(controller.text).toContain('class DeviceAuthController');
        await request(app).get('/app.js').expect(410);
        await request(app).get('/index.html').expect(404);
    });

    it('retires the unused selector and keeps Catalog verification references resolvable', () => {
        const capability = yaml.load(readFileSync('docs/brainbase-capabilities/capabilities/project.selector.yml', 'utf8'));
        expect(capability.lifecycle).toBe('retired');
        const catalog = yaml.load(readFileSync(capability.current_evidence_capability, 'utf8'));
        for (const file of catalog.surfaces.code) expect(existsSync(file), file).toBe(true);
        for (const command of capability.verification.commands) {
            for (const file of command.match(/tests\/[^\s]+/g) || []) expect(existsSync(file), file).toBe(true);
        }
    });

    it('leaves no literal imports of deleted modules in remaining source or tests', () => {
        const references = [];
        const walk = directory => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                if (entry.isSymbolicLink() || ['node_modules', '.git', '.ua', 'dist'].includes(entry.name)) continue;
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) { walk(file); continue; }
                if (!/\.(?:[cm]?js|tsx?|jsx)$/.test(file)) continue;
                const source = readFileSync(file, 'utf8');
                const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*)['"`]([^'"`]+)['"`]/g;
                for (const match of source.matchAll(imports)) {
                    const specifier = match[1].split('?')[0];
                    const target = specifier.startsWith('/modules/')
                        ? path.join(publicDir, specifier.slice(1))
                        : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
                    if (target?.startsWith(publicDir + path.sep) && !existsSync(target)) {
                        references.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
                    }
                }
            }
        };
        for (const directory of ['public', 'server', 'lib', 'scripts', 'cli', 'mcp', 'tests']) {
            walk(path.join(process.cwd(), directory));
        }
        expect(references).toEqual([]);
    });

    it.each(['terminal.transport', 'session.hibernation', 'session.create', 'project.selector'])('%s describes a retired boundary, not live operations', name => {
        const capability = yaml.load(readFileSync(
            `docs/brainbase-capabilities/capabilities/${name}.yml`, 'utf8'));
        expect(capability.lifecycle).toBe('retired');
        expect(capability.surfaces).toEqual({ ui: [], api: [], code: [], data: [] });
        expect(capability.depends_on).toEqual([]);
        expect(capability.runbooks).toEqual([]);
        expect(capability.architecture_decision).toContain('ADR-019');
        for (const document of capability.history.documents) expect(existsSync(document)).toBe(true);
    });
});
