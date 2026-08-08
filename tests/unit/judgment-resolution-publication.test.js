import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(path, 'utf8');
}

describe('judgment resolver publication surfaces', () => {
    // Trace: story-brainbase-judgment-resolver-v1:ac:14
    it('CLAUDEとAGENTSのalways-loaded host contractを同一に保つ', () => {
        const claude = read('CLAUDE.md');
        const agents = read('AGENTS.md');
        expect(agents).toBe(claude);
        expect(claude).toContain('brainbase_judgment_resolve');
        expect(claude).toContain('各Codex turn');
        expect(claude).toContain('選択されたactive DAGだけ');
        expect(claude).toContain('write/external');
    });

    it('Codex UserPromptSubmit hookがturnごとの最小DAG入口を注入する', () => {
        const result = spawnSync('bash', ['scripts/codex-hooks/judgment-resolver-entry.sh'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit',
                session_id: 'session-1',
                turn_id: 'turn-2',
                cwd: '/workspace/vibepro',
                prompt: '続けて',
            }),
        });

        expect(result.status).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.continue).toBe(true);
        expect(output.suppressOutput).toBe(true);
        expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'mcp__brainbase__brainbase_judgment_resolve exactly once',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain('"turn_id":"turn-2"');
        expect(output.hookSpecificOutput.additionalContext).not.toContain('"session_id":"session-1"');
        expect(output.hookSpecificOutput.additionalContext).not.toContain('"cwd":"/workspace/vibepro"');
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'classification_proposal must be one nested object',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Never send session_id, cwd, flat proposed_* fields',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'not to write or act externally is none or read',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Validate the complete argument object against the tool schema',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain('active_node_definitions');
        expect(output.hookSpecificOutput.additionalContext).toContain('not the entire judgment library');
        expect(output.hookSpecificOutput.additionalContext).toContain('never authorizes write or external action');
    });

    it('Skill・capability・runbook・catalogを相互参照可能にする', () => {
        const skill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const capability = read('docs/brainbase-capabilities/capabilities/judgment.resolve.yml');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const catalog = read('docs/brainbase-capabilities/README.md');
        const capabilityMap = read('.claude/skills/brainbase-capability-map/SKILL.md');

        expect(skill).toContain('judgment.resolve.yml');
        expect(skill).toContain('brainbase_judgment_resolve');
        expect(skill).toContain('required_capabilities');
        expect(skill).toContain('active_node_definitions');
        expect(capability).toContain('id: judgment.resolve');
        expect(capability).toContain('conversation_context');
        expect(capability).toContain('receipt does not authorize');
        expect(runbook).toContain('management_status=managed');
        expect(runbook).toContain('conversation_context');
        expect(runbook).toContain('active_node_definitions');
        expect(catalog).toContain('`judgment.resolve`');
        expect(capabilityMap).toContain('`judgment.resolve`');
    });

    it('binding secretをenv・MCP preflight・運用手順へ公開する', () => {
        const envExample = read('.env.example');
        const infisicalTargets = JSON.parse(read('config/infisical-targets.json'));
        const launcher = read('scripts/run-brainbase-mcp.sh');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');

        expect(envExample).toContain('BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(envExample).toContain('BRAINBASE_JUDGMENT_ADAPTER_ID=brainbase-mcp');
        expect(infisicalTargets.targets['brainbase-mcp'].requiredKeys).toContain(
            'BRAINBASE_JUDGMENT_BINDING_SECRET',
        );
        expect(launcher).toContain('missing BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(launcher).toContain('BRAINBASE_JUDGMENT_BINDING_SECRET must be at least 32 characters');
        expect(launcher).toContain('preflight-judgment-binding.js');
        expect(runbook).toContain('Binding secret provisioning and rotation');
        expect(runbook).toContain('Initial release order');
        expect(runbook).toContain('Rollback');
        expect(runbook).toContain('scripts/run-brainbase-mcp.sh --check');
        expect(runbook).toContain('signed read-only probe');
    });
});
