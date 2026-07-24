import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = relativePath => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Brainbase development runtime boundary', () => {
    it('does not compose session, worktree, or terminal lifecycle services', () => {
        const composition = [
            read('server.js'),
            read('server/bootstrap/core-services.js'),
            read('server/bootstrap/register-api-routes.js'),
            read('server/bootstrap/graceful-shutdown.js')
        ].join('\n');

        for (const forbidden of [
            'createSessionServices',
            'WorktreeService',
            'ArchiveFinalizerService',
            'TerminalTransportService',
            'TerminalRuntimeReconciler',
            'ConversationLinker',
            'initializeSessionRuntime',
            'sessionServices.runtime'
        ]) {
            expect(composition).not.toContain(forbidden);
        }
    });

    it('keeps retired HTTP surfaces explicit', () => {
        const server = read('server.js');
        const routes = read('server/bootstrap/register-api-routes.js');

        expect(server).toContain("app.use('/console'");
        expect(server).toContain("res.status(410)");
        for (const route of ['/api/state', '/api/sessions', '/api/terminal']) {
            expect(routes).toContain(`app.use('${route}', createRetiredCapabilityRouter`);
        }
    });
});
