import { test } from 'vitest';
import assert from 'node:assert/strict';
import { districtTaskActors } from '../../ui/world/world-placement.js';
const site = state => ({ task_id: 't1', work: { status: state }, actors_state: 'confirmed', actors: [{ id: 'agent_test', name: 'AI test', task_id: 't1', state, kind: 'agent', activity: { state: 'running', moving: true, heartbeat_at: new Date().toISOString() } }] });
test('only recorded in_progress Task actors move; waiting/pending/completed/cancelled stay still', () => {
  for (const state of ['pending','in_progress','waiting','completed','cancelled']) assert.equal(districtTaskActors(site(state))[0].moving, state === 'in_progress');
});
test('unknown, mismatched and duplicate actors do not imply execution', () => {
  assert.deepEqual(districtTaskActors({ ...site('in_progress'), actors_state: 'unconfirmed' }), []);
  const record = site('waiting'); record.actors[0].state = 'in_progress'; assert.deepEqual(districtTaskActors(record), []);
  const other = site('pending'); other.actors[0].task_id = 't2'; assert.deepEqual(districtTaskActors(other), []);
  const duplicate = site('pending'); duplicate.actors.push(duplicate.actors[0]); assert.equal(districtTaskActors(duplicate).length, 1);
});

test('assignment and an in_progress Task alone never imply a running agent', () => { const value = site('in_progress'); delete value.actors[0].activity; assert.equal(districtTaskActors(value)[0].moving, false); });

test('a loaded street stops motion when the last confirmed heartbeat becomes stale', () => { const value = site('in_progress'); assert.equal(districtTaskActors(value, Date.parse(value.actors[0].activity.heartbeat_at) + 300001)[0].moving, false); });
