import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GoalSeekStore } from '../../../server/services/goal-seek-store.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

describe('GoalSeekStore V2', () => {
    let store;
    let tmpDir;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `gs-test-${Date.now()}`);
        await fs.mkdir(tmpDir, { recursive: true });
        store = new GoalSeekStore(tmpDir);
        await store.init();
    });

    afterEach(async () => {
        try { await fs.rm(tmpDir, { recursive: true }); } catch {}
    });

    // ========== Goal CRUD ==========

    describe('Goal CRUD', () => {
        it('createGoal returns a goal with generated id', () => {
            const goal = store.createGoal({
                sessionId: 'session-123',
                title: 'Test Goal',
                description: 'desc',
                criteria: { commit: ['Tests pass'] },
                managerConfig: { autoAnswerLevel: 'aggressive' }
            });

            expect(goal.id).toMatch(/^goal_/);
            expect(goal.sessionId).toBe('session-123');
            expect(goal.title).toBe('Test Goal');
            expect(goal.description).toBe('desc');
            expect(goal.criteria.commit).toEqual(['Tests pass']);
            expect(goal.managerConfig.autoAnswerLevel).toBe('aggressive');
            expect(goal.status).toBe('active');
            expect(goal.createdAt).toBeTruthy();
        });

        it('createGoal uses defaults for optional fields', () => {
            const goal = store.createGoal({ sessionId: 's1', title: 'T' });
            expect(goal.description).toBe('');
            expect(goal.criteria).toEqual({ commit: [], signal: [] });
            expect(goal.managerConfig.autoAnswerLevel).toBe('moderate');
        });

        it('getGoal retrieves by id', () => {
            const created = store.createGoal({ sessionId: 's1', title: 'T' });
            const found = store.getGoal(created.id);
            expect(found).toEqual(created);
        });

        it('getGoal returns null for unknown id', () => {
            expect(store.getGoal('goal_nope')).toBeNull();
        });

        it('getGoalBySessionId finds active goal', () => {
            store.createGoal({ sessionId: 's1', title: 'A' });
            const found = store.getGoalBySessionId('s1');
            expect(found.title).toBe('A');
        });

        it('getGoalBySessionId skips completed goals', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'A' });
            store.updateGoal(g.id, { status: 'completed' });
            expect(store.getGoalBySessionId('s1')).toBeNull();
        });

        it('getAllGoals returns all goals', () => {
            store.createGoal({ sessionId: 's1', title: 'A' });
            store.createGoal({ sessionId: 's2', title: 'B' });
            expect(store.getAllGoals()).toHaveLength(2);
        });

        it('updateGoal updates allowed fields', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'Old' });
            const updated = store.updateGoal(g.id, { title: 'New', status: 'monitoring' });
            expect(updated.title).toBe('New');
            expect(updated.status).toBe('monitoring');
            expect(updated.updatedAt).toBeTruthy();
        });

        it('updateGoal ignores non-allowed fields', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            store.updateGoal(g.id, { id: 'hacked', sessionId: 'hacked' });
            const found = store.getGoal(g.id);
            expect(found.id).toBe(g.id);
            expect(found.sessionId).toBe('s1');
        });

        it('updateGoal returns null for unknown id', () => {
            expect(store.updateGoal('goal_nope', { title: 'X' })).toBeNull();
        });

        it('deleteGoal removes goal and related data', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            store.addProblem({ goalId: g.id, sessionId: 's1', type: 'error', severity: 'warning', title: 'E' });
            store.addEscalation({ goalId: g.id, sessionId: 's1', question: 'Q' });
            store.addTimelineEntry({ goalId: g.id, type: 'progress', summary: 'S' });

            expect(store.deleteGoal(g.id)).toBe(true);
            expect(store.getGoal(g.id)).toBeNull();
            expect(store.getProblems(g.id)).toHaveLength(0);
            expect(store.getTimeline(g.id)).toHaveLength(0);
        });

        it('deleteGoal returns false for unknown id', () => {
            expect(store.deleteGoal('goal_nope')).toBe(false);
        });
    });

    // ========== Problem CRUD ==========

    describe('Problem CRUD', () => {
        it('addProblem creates with defaults', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            const p = store.addProblem({
                goalId: g.id,
                sessionId: 's1',
                type: 'error',
                severity: 'critical',
                title: 'Fatal'
            });

            expect(p.id).toMatch(/^prob_/);
            expect(p.status).toBe('detected');
            expect(p.analysisBy).toBe('detector');
            expect(p.suggestedActions).toEqual([]);
        });

        it('getProblems filters by goalId', () => {
            const g1 = store.createGoal({ sessionId: 's1', title: 'G1' });
            const g2 = store.createGoal({ sessionId: 's2', title: 'G2' });
            store.addProblem({ goalId: g1.id, sessionId: 's1', type: 'error', severity: 'warning', title: 'P1' });
            store.addProblem({ goalId: g2.id, sessionId: 's2', type: 'stuck', severity: 'warning', title: 'P2' });

            expect(store.getProblems(g1.id)).toHaveLength(1);
            expect(store.getProblems(g1.id)[0].title).toBe('P1');
        });

        it('updateProblemStatus changes status', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            const p = store.addProblem({ goalId: g.id, sessionId: 's1', type: 'error', severity: 'warning', title: 'E' });
            const updated = store.updateProblemStatus(p.id, 'resolved');
            expect(updated.status).toBe('resolved');
        });

        it('updateProblemStatus returns null for unknown', () => {
            expect(store.updateProblemStatus('prob_nope', 'resolved')).toBeNull();
        });
    });

    // ========== Escalation CRUD ==========

    describe('Escalation CRUD', () => {
        it('addEscalation creates with pending status', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            const e = store.addEscalation({
                goalId: g.id,
                sessionId: 's1',
                question: 'Which approach?',
                context: 'Context here',
                options: [{ id: '1', label: 'A' }]
            });

            expect(e.id).toMatch(/^esc_/);
            expect(e.status).toBe('pending');
            expect(e.response).toBeNull();
        });

        it('getPendingEscalations filters pending only', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            const e1 = store.addEscalation({ goalId: g.id, sessionId: 's1', question: 'Q1' });
            store.addEscalation({ goalId: g.id, sessionId: 's1', question: 'Q2' });
            store.respondToEscalation(e1.id, { choice: 'yes' });

            expect(store.getPendingEscalations(g.id)).toHaveLength(1);
        });

        it('respondToEscalation sets status to responded', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            const e = store.addEscalation({ goalId: g.id, sessionId: 's1', question: 'Q' });
            const responded = store.respondToEscalation(e.id, { choice: 'yes', reason: 'OK' });

            expect(responded.status).toBe('responded');
            expect(responded.response).toEqual({ choice: 'yes', reason: 'OK' });
            expect(responded.respondedAt).toBeTruthy();
        });

        it('respondToEscalation returns null for unknown', () => {
            expect(store.respondToEscalation('esc_nope', {})).toBeNull();
        });
    });

    // ========== Timeline ==========

    describe('Timeline', () => {
        it('addTimelineEntry creates entry', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            const entry = store.addTimelineEntry({
                goalId: g.id,
                type: 'progress',
                summary: 'Started',
                details: 'Details here'
            });

            expect(entry.id).toMatch(/^tl_/);
            expect(entry.type).toBe('progress');
        });

        it('getTimeline returns sorted entries', () => {
            const g = store.createGoal({ sessionId: 's1', title: 'T' });
            store.addTimelineEntry({ goalId: g.id, type: 'progress', summary: 'First' });
            store.addTimelineEntry({ goalId: g.id, type: 'problem', summary: 'Second' });

            const timeline = store.getTimeline(g.id);
            expect(timeline).toHaveLength(2);
            expect(new Date(timeline[0].timestamp) <= new Date(timeline[1].timestamp)).toBe(true);
        });

        it('getTimeline filters by goalId', () => {
            const g1 = store.createGoal({ sessionId: 's1', title: 'G1' });
            const g2 = store.createGoal({ sessionId: 's2', title: 'G2' });
            store.addTimelineEntry({ goalId: g1.id, type: 'progress', summary: 'A' });
            store.addTimelineEntry({ goalId: g2.id, type: 'progress', summary: 'B' });

            expect(store.getTimeline(g1.id)).toHaveLength(1);
        });
    });

    // ========== Persistence ==========

    describe('Persistence', () => {
        it('saves and loads data from file', async () => {
            store.createGoal({ sessionId: 's1', title: 'Persistent Goal' });

            // Wait for async _save() to complete
            await new Promise(r => setTimeout(r, 100));

            // Create a new store instance pointing to same file
            const store2 = new GoalSeekStore(tmpDir);
            await store2.init();

            const goals = store2.getAllGoals();
            expect(goals).toHaveLength(1);
            expect(goals[0].title).toBe('Persistent Goal');
        });

        it('init handles missing file gracefully', async () => {
            const emptyDir = path.join(os.tmpdir(), `gs-empty-${Date.now()}`);
            await fs.mkdir(emptyDir, { recursive: true });
            const s = new GoalSeekStore(emptyDir);
            await s.init();
            expect(s.getAllGoals()).toEqual([]);
            await fs.rm(emptyDir, { recursive: true });
        });

        it('init handles corrupted file gracefully', async () => {
            await fs.writeFile(path.join(tmpDir, 'goals.json'), 'INVALID JSON');
            const s = new GoalSeekStore(tmpDir);
            await s.init();
            expect(s.getAllGoals()).toEqual([]);
        });
    });
});
