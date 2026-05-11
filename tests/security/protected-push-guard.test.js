import { describe, it, expect } from 'vitest';
import {
    isProtectedPushBlocked,
    PROTECTED_BRANCHES
} from '../../scripts/lib/protected-push-guard.js';

describe('protected push guard', () => {
    describe('block: 14e7c58d incident exact pattern', () => {
        it('blocks "git branch -f develop <ref> && git push origin develop"', () => {
            const cmd = 'git branch -f develop feat/brainbase-mana-secretary-memory-promotion-clean && git push origin develop';
            const result = isProtectedPushBlocked(cmd);
            expect(result.blocked).toBe(true);
            expect(result.reason).toContain('develop');
        });
    });

    describe('block: direct push to protected branches', () => {
        for (const branch of PROTECTED_BRANCHES) {
            it(`blocks "git push origin ${branch}"`, () => {
                expect(isProtectedPushBlocked(`git push origin ${branch}`).blocked).toBe(true);
            });

            it(`blocks "git push -u origin ${branch}"`, () => {
                expect(isProtectedPushBlocked(`git push -u origin ${branch}`).blocked).toBe(true);
            });

            it(`blocks "git push origin HEAD:${branch}"`, () => {
                expect(isProtectedPushBlocked(`git push origin HEAD:${branch}`).blocked).toBe(true);
            });

            it(`blocks "git push origin feat/x:${branch}"`, () => {
                expect(isProtectedPushBlocked(`git push origin feat/x:${branch}`).blocked).toBe(true);
            });
        }
    });

    describe('block: force push variants', () => {
        it('blocks "git push --force origin develop"', () => {
            expect(isProtectedPushBlocked('git push --force origin develop').blocked).toBe(true);
        });

        it('blocks "git push -f origin develop"', () => {
            expect(isProtectedPushBlocked('git push -f origin develop').blocked).toBe(true);
        });

        it('blocks "git push --force-with-lease origin develop"', () => {
            expect(isProtectedPushBlocked('git push --force-with-lease origin develop').blocked).toBe(true);
        });

        it('blocks "git push --force origin main" (force to main)', () => {
            expect(isProtectedPushBlocked('git push --force origin main').blocked).toBe(true);
        });
    });

    describe('block: git branch -f / -D on protected', () => {
        it('blocks "git branch -f develop <ref>"', () => {
            expect(isProtectedPushBlocked('git branch -f develop abc123').blocked).toBe(true);
        });

        it('blocks "git branch -D develop"', () => {
            expect(isProtectedPushBlocked('git branch -D develop').blocked).toBe(true);
        });

        it('blocks "git branch --force develop other-branch"', () => {
            expect(isProtectedPushBlocked('git branch --force develop other-branch').blocked).toBe(true);
        });

        it('blocks "git branch -fM main"', () => {
            expect(isProtectedPushBlocked('git branch -fM main').blocked).toBe(true);
        });
    });

    describe('allow: legitimate operations', () => {
        it('allows "git pull origin develop"', () => {
            expect(isProtectedPushBlocked('git pull origin develop').blocked).toBe(false);
        });

        it('allows "git fetch origin develop"', () => {
            expect(isProtectedPushBlocked('git fetch origin develop').blocked).toBe(false);
        });

        it('allows "git checkout origin/develop"', () => {
            expect(isProtectedPushBlocked('git checkout origin/develop').blocked).toBe(false);
        });

        it('allows "git push origin feat/foo"', () => {
            expect(isProtectedPushBlocked('git push origin feat/foo').blocked).toBe(false);
        });

        it('allows "git push origin fix/develop-bar" (feature branch containing develop)', () => {
            expect(isProtectedPushBlocked('git push origin fix/develop-bar').blocked).toBe(false);
        });

        it('allows "git push origin feature/main-menu"', () => {
            expect(isProtectedPushBlocked('git push origin feature/main-menu').blocked).toBe(false);
        });

        it('allows "git push -u origin session/foo"', () => {
            expect(isProtectedPushBlocked('git push -u origin session/foo').blocked).toBe(false);
        });

        it('allows "git rebase origin/develop" (rebase, not push)', () => {
            expect(isProtectedPushBlocked('git rebase origin/develop').blocked).toBe(false);
        });

        it('allows "git branch develop other-branch" (no -f flag)', () => {
            expect(isProtectedPushBlocked('git branch develop other-branch').blocked).toBe(false);
        });

        it('allows "git status"', () => {
            expect(isProtectedPushBlocked('git status').blocked).toBe(false);
        });
    });

    describe('block: bypass via subshell / pipe / && chain', () => {
        it('blocks "cd /tmp && git push origin develop"', () => {
            expect(isProtectedPushBlocked('cd /tmp && git push origin develop').blocked).toBe(true);
        });

        it('blocks "echo foo; git push origin main"', () => {
            expect(isProtectedPushBlocked('echo foo; git push origin main').blocked).toBe(true);
        });

        it('blocks "bash -c \\"git push origin develop\\""', () => {
            expect(isProtectedPushBlocked('bash -c "git push origin develop"').blocked).toBe(true);
        });
    });

    describe('emergency override', () => {
        it('allows when BRAINBASE_ALLOW_PROTECTED_PUSH=1 env in command', () => {
            const cmd = 'BRAINBASE_ALLOW_PROTECTED_PUSH=1 git push origin develop';
            expect(isProtectedPushBlocked(cmd).blocked).toBe(false);
        });
    });
});
