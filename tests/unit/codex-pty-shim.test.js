import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function runPython(source) {
    return spawnSync('python3', ['-c', source], {
        cwd: repoRoot,
        encoding: 'utf8'
    });
}

describe('codex-pty-shim activity fallback', () => {
    it('Codexスピナー出力をworkingとして検出する', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)
print(shim.detect_codex_activity(b'\\x1b]0;\\xe2\\xa0\\xa6 session-123...\\x07'))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('working');
    });

    it('working中にCodexプロンプトが戻ったらdoneを送る', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

class FakeReporter(shim.ActivityReporter):
    def __init__(self):
        super().__init__({"BRAINBASE_SESSION_ID": "session-test", "BRAINBASE_PORT": "31013"}, clock=lambda: 1000.0)
        self.posts = []
    def _post(self, payload):
        self.posts.append(payload)

reporter = FakeReporter()
reporter.observe("working")
reporter.observe("ready")
print([post["status"] for post in reporter.posts])
print([post["lifecycle"] for post in reporter.posts])
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("['working', 'done']");
        expect(result.stdout).toContain("['turn_started', 'turn_completed']");
    });
});
