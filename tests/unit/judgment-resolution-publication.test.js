import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(path, 'utf8');
}

describe('judgment resolver publication surfaces', () => {
    it('成功時のresponse終了契約をhook・Skill・runbookで同期する', () => {
        const result = spawnSync('bash', ['scripts/codex-hooks/judgment-resolver-entry.sh'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit',
                turn_id: 'terminal-contract-turn',
                prompt: '回答して',
            }),
        });
        const hookContext = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        const skill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const surfaces = [hookContext, skill, runbook];

        for (const surface of surfaces) {
            expect(surface).toContain('Managed or resolved status alone is not a stop condition.');
            expect(surface).toContain(
                "When selected nodes and required capabilities are complete, the user's requested answer or work is complete, and no unresolved item remains, emit the completed final response immediately.",
            );
            expect(surface).toContain(
                'Do not begin self-initiated repo, memory, search, shell, or additional-tool exploration afterward.',
            );
            expect(surface).toContain(
                'Continue while an active node, required capability, or explicitly requested investigation, implementation, or operation remains unfinished.',
            );
        }
    });

    it('回答完結のreceipt後にproject名だけでSkill・repo・memory取得へ広げない', () => {
        const result = spawnSync('bash', ['scripts/codex-hooks/judgment-resolver-entry.sh'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit',
                turn_id: 'context-complete-turn',
                prompt: 'VibeProの制御構造を導いて',
            }),
        });
        const hookContext = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        const resolverSkill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const surfaces = [hookContext, resolverSkill, runbook];

        for (const surface of surfaces) {
            expect(surface).toContain(
                'An answer-only design request is context-complete when its goal and constraints are explicit, required_capabilities and unresolved are empty, and the selected node instructions directly determine the answer.',
            );
            expect(surface).toContain(
                'For a context-complete request, treat the receipt as the project judgment context and answer without loading project workflow skills, repo files, or memory merely because a project name appears.',
            );
            expect(surface).toContain(
                'Retrieve more context only when the user explicitly requests current repository or history evidence, or an active node, required capability, or unresolved item requires it.',
            );
        }

        const vibeproWorkflow = read('.claude/skills/vibepro-workflow/SKILL.md');
        expect(vibeproWorkflow).toContain(
            'Do not use for answer-only conceptual architecture or judgment questions that merely mention VibePro and are context-complete in a Brainbase Judgment Resolver receipt.',
        );
    });

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
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'intent=answer|investigate|diagnose|design|implement|review|operate',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'confidence=confirmed|inferred|unknown, never a number',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Never invent or translate enum values',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Domain and signal support is lexical and server-owned',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Every proposed domain and signal must have a matching term',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            '"personal_judgment":["俺の判断","私の判断","思考アルゴリズム","判断基準"]',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            '"problem_frame_uncertain":["前提がおかしい","問題設定","根本原因","そもそも"]',
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'an exact authority signal selects authority_boundary instead',
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
