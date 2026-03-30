import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningHealthService } from '../../../server/services/learning-health-service.js';

function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

describe('LearningHealthService', () => {
    const tempRoots = [];

    afterEach(() => {
        while (tempRoots.length > 0) {
            fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
        }
    });

    it('launch agent が無い場合は unconfigured を返す', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-health-'));
        tempRoots.push(root);
        const service = new LearningHealthService({
            launchAgentPath: path.join(root, 'LaunchAgents/com.brainbase.learning.plist'),
            stateDir: path.join(root, 'var/learning')
        });
        service._getLaunchctlState = vi.fn(async () => ({ loaded: false, lastExitStatus: null, pid: null }));

        const result = await service.getHealth(new Date('2026-03-28T22:00:00+09:00'));

        expect(result.status).toBe('unconfigured');
    });

    it('summary が新しければ healthy を返す', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-health-'));
        tempRoots.push(root);
        const plistPath = path.join(root, 'LaunchAgents/com.brainbase.learning.plist');
        const stateDir = path.join(root, 'var/learning');
        writeFile(plistPath, `
            <plist><dict>
              <key>StartCalendarInterval</key>
              <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
            </dict></plist>
        `);
        writeFile(path.join(stateDir, 'daily-summary.json'), JSON.stringify({
            generated_at: '2026-03-28T12:05:00.000Z'
        }));

        const service = new LearningHealthService({ launchAgentPath: plistPath, stateDir });
        service._getLaunchctlState = vi.fn(async () => ({ loaded: true, lastExitStatus: 0, pid: 123 }));

        const result = await service.getHealth(new Date('2026-03-28T22:00:00+09:00'));

        expect(result.status).toBe('healthy');
        expect(result.agent_loaded).toBe(true);
    });

    it('予定時刻を過ぎても summary が古ければ stale を返す', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-health-'));
        tempRoots.push(root);
        const plistPath = path.join(root, 'LaunchAgents/com.brainbase.learning.plist');
        const stateDir = path.join(root, 'var/learning');
        writeFile(plistPath, `
            <plist><dict>
              <key>StartCalendarInterval</key>
              <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
            </dict></plist>
        `);
        writeFile(path.join(stateDir, 'daily-summary.json'), JSON.stringify({
            generated_at: '2026-03-27T12:05:00.000Z'
        }));

        const service = new LearningHealthService({ launchAgentPath: plistPath, stateDir });
        service._getLaunchctlState = vi.fn(async () => ({ loaded: true, lastExitStatus: 0, pid: 123 }));

        const result = await service.getHealth(new Date('2026-03-28T22:00:00+09:00'));

        expect(result.status).toBe('stale');
    });

    it('last exit status が非ゼロなら error を返す', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-health-'));
        tempRoots.push(root);
        const plistPath = path.join(root, 'LaunchAgents/com.brainbase.learning.plist');
        const stateDir = path.join(root, 'var/learning');
        writeFile(plistPath, `
            <plist><dict>
              <key>StartCalendarInterval</key>
              <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
            </dict></plist>
        `);
        writeFile(path.join(stateDir, 'daily-summary.json'), JSON.stringify({
            generated_at: '2026-03-28T12:05:00.000Z'
        }));

        const service = new LearningHealthService({ launchAgentPath: plistPath, stateDir });
        service._getLaunchctlState = vi.fn(async () => ({ loaded: true, lastExitStatus: 1, pid: null }));

        const result = await service.getHealth(new Date('2026-03-28T22:00:00+09:00'));

        expect(result.status).toBe('error');
    });
});
