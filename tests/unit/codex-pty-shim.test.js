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
    it('外側端末の capability response をCodex入力へ転送しない', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

sanitizer = shim.OuterInputSanitizer()
chunks = [
    b'hello',
    b'\\x1b[?0u',
    b' world',
    b'\\x1b[I',
    b'\\x1b]10;rgb:0000/0000/0000\\x1b\\\\',
    b'!',
]
print(b''.join(sanitizer.feed(chunk) for chunk in chunks).decode('utf-8'))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('hello world!');
    });

    it('ESCが上流で消費されたbare focus fragmentもCodex入力へ転送しない', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

sanitizer = shim.OuterInputSanitizer()
chunks = [
    b'prompt',
    b'[I',
    b' text',
    b'[O',
    b'!',
]
print(b''.join(sanitizer.feed(chunk) for chunk in chunks).decode('utf-8'))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('prompt text!');
    });

    it('分割されたbare focus fragmentも保持してまとめて捨てる', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

sanitizer = shim.OuterInputSanitizer()
parts = [
    b'a',
    b'[',
    b'I',
    b'b',
    b'[',
    b'O',
    b'c',
]
print(b''.join(sanitizer.feed(part) for part in parts).decode('utf-8'))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('abc');
    });

    it('分割された端末応答も保持してまとめて捨てる', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

sanitizer = shim.OuterInputSanitizer()
parts = [
    b'a',
    b'\\x1b',
    b'[?',
    b'0u',
    b'b',
    b'\\x1b]11;rgb:1111',
    b'/2222/3333',
    b'\\x07',
    b'c',
]
print(b''.join(sanitizer.feed(part) for part in parts).decode('utf-8'))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('abc');
    });

    it('通常のユーザー入力や矢印キーは転送対象として残す', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

sanitizer = shim.OuterInputSanitizer()
data = sanitizer.feed(b'abc\\x1b[A\\r')
print(data.hex())
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('6162631b5b410d');
    });

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

    it('Codexプロンプトが同じ描画chunkにあればreadyをworkingより優先する', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)
print(shim.detect_codex_activity(b'\\xe2\\xa0\\xb9 rendering old line\\n\\xe2\\x80\\xba '))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('ready');
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

    it('Codex PTY turnIdにはsession作成時刻ではなくturn開始時刻を使う', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

class FakeReporter(shim.ActivityReporter):
    def __init__(self):
        super().__init__({"BRAINBASE_SESSION_ID": "session-1777000000000", "BRAINBASE_PORT": "31013"}, clock=lambda: 1778118000.0)
        self.posts = []
    def _post(self, payload):
        self.posts.append(payload)

reporter = FakeReporter()
reporter.observe("working")
reporter.observe("ready")
print(reporter.posts[0]["turnId"])
print(reporter.posts[1]["turnId"])
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        const lines = result.stdout.trim().split('\n');
        expect(lines[0]).toMatch(/^codex-pty-turn-1778118000000-\d+$/);
        expect(lines[1]).toBe(lines[0]);
    });

    it('activity report POSTにCSRFヘッダーを付与する', () => {
        const scriptPath = path.join(repoRoot, 'scripts/codex-pty-shim.py');
        const result = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("shim", ${JSON.stringify(scriptPath)})
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

reporter = shim.ActivityReporter({"BRAINBASE_SESSION_ID": "session-test", "BRAINBASE_PORT": "31013"}, clock=lambda: 1000.0)
reporter._get_csrf_token = lambda: "test-csrf-token"
args = reporter._build_post_args({"sessionId": "session-test", "status": "working", "reportedAt": 1000})
print("\\n".join(args))
`);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('X-Session-Id: session-test');
        expect(result.stdout).toContain('X-CSRF-Token: test-csrf-token');
    });
});
