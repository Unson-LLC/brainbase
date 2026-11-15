import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ACTOR_TONES, actorTone, cityPulse, districtPulse, siteActors, streetKeyOf, worldPulse } from '../../ui/world/world-placement.js';

const NOW = Date.parse('2026-11-12T03:00:00.000Z');
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();
let n = 0;
function site(status, { purpose = '予約を逃さない', agent = null, heartbeat = 1, moving = true, created = 10, actorsState = 'confirmed', waitingOn = null } = {}) {
  const task_id = `t${++n}`;
  return {
    task_id, title: `仕事 ${task_id}`, purpose_label: purpose, actors_state: actorsState,
    work: { status, created_at: ago(created * 1440), waiting_on: waitingOn },
    actors: agent ? [{ id: agent, name: `AI ${agent}`, task_id, state: status, kind: 'agent', activity: heartbeat === null ? undefined : { state: 'running', moving, heartbeat_at: ago(heartbeat) } }] : [],
  };
}

test('an agent is 動いている only on an in-progress Task with a heartbeat confirmed within five minutes', () => {
  assert.equal(siteActors(site('in_progress', { agent: 'a' }), NOW)[0].presence, 'running');
  const stale = siteActors(site('in_progress', { agent: 'a', heartbeat: 12 }), NOW)[0];
  assert.equal(stale.presence, 'quiet');
  assert.equal(stale.minutes, 12);
  assert.equal(siteActors(site('in_progress', { agent: 'a', heartbeat: null }), NOW)[0].presence, 'unconfirmed');
  assert.equal(siteActors(site('in_progress', { agent: 'a', moving: false }), NOW)[0].presence, 'unconfirmed');
});

test('the recorded state of the Task decides the rest: waiting, not started, finished', () => {
  const waiting = siteActors(site('waiting', { agent: 'a', waitingOn: '費用の承認' }), NOW)[0];
  assert.equal(waiting.presence, 'waiting');
  assert.equal(waiting.waiting_on, '費用の承認');
  assert.equal(siteActors(site('pending', { agent: 'a' }), NOW)[0].presence, 'queued');
  assert.equal(siteActors(site('completed', { agent: 'a' }), NOW)[0].presence, 'done');
});

test('agents the host did not confirm are not drawn, and are counted as unconfirmed rather than as nobody', () => {
  const unconfirmed = site('in_progress', { agent: 'a', actorsState: 'unconfirmed' });
  assert.deepEqual(siteActors(unconfirmed, NOW), []);
  const pulse = districtPulse([unconfirmed], NOW);
  assert.equal(pulse.actors.length, 0);
  assert.equal(pulse.actors_unconfirmed, 1);
  assert.equal(pulse.streets[0].actors_unconfirmed, 1);
});

test('a district counts its work by recorded state and leaves cancelled work out', () => {
  const pulse = districtPulse([site('in_progress'), site('in_progress'), site('waiting'), site('pending'), site('completed'), site('cancelled')], NOW);
  assert.deepEqual(pulse.counts, { total: 5, done: 1, in_progress: 2, waiting: 1, pending: 1 });
});

test('streets come in the order they stand: oldest purpose first, the unlabelled last', () => {
  const pulse = districtPulse([
    site('pending', { purpose: null, created: 30 }),
    site('in_progress', { purpose: 'LINEで完結', created: 3, agent: 'b' }),
    site('completed', { purpose: '予約を逃さない', created: 20 }),
    site('in_progress', { purpose: '予約を逃さない', created: 6, agent: 'a' }),
  ], NOW);
  assert.deepEqual(pulse.streets.map((street) => [street.key, street.label, street.counts.total, street.counts.done]), [['予約を逃さない', '予約を逃さない', 2, 1], ['LINEで完結', 'LINEで完結', 1, 0], ['', null, 1, 0]]);
  assert.equal(streetKeyOf({ purpose_label: '  ' }), '');
  assert.deepEqual(pulse.streets[0].actors.map((actor) => actor.id), ['a']);
  assert.equal(pulse.streets[0].running, 1);
});

test('an agent on several works is one agent, shown by its most active work, with each work listed', () => {
  const pulse = districtPulse([
    site('waiting', { agent: 'a', purpose: 'LINEで完結' }),
    site('in_progress', { agent: 'a' }),
    site('in_progress', { agent: 'b', heartbeat: 20 }),
  ], NOW);
  assert.deepEqual(pulse.actors.map((actor) => [actor.id, actor.presence, actor.works.length]), [['a', 'running', 2], ['b', 'quiet', 1]]);
  assert.equal(pulse.running, 1);
  assert.deepEqual(pulse.actors[0].works.map((work) => work.presence), ['running', 'waiting']);
  assert.equal(pulse.actors[0].works[1].street, 'LINEで完結');
});

test('an agent keeps one soft colour wherever it appears', () => {
  assert.equal(actorTone('agent_x'), actorTone('agent_x'));
  assert.ok(ACTOR_TONES.includes(actorTone('agent_x')));
  assert.equal(siteActors(site('in_progress', { agent: 'agent_x' }), NOW)[0].tone, actorTone('agent_x'));
});

test('the world orders businesses by work in progress; unread work is not zero', () => {
  assert.equal(cityPulse(undefined), null);
  assert.equal(cityPulse({ state: 'failed', by_status: null }), null);
  assert.deepEqual(cityPulse({ state: 'partial', by_status: { in_progress: 2, completed: 3 } }), { in_progress: 2, waiting: 0, pending: 0, done: 3, partial: true });
  const world = worldPulse(
    [{ code: 'quiet', name: 'しずか' }, { code: 'busy', name: 'にぎやか' }, { code: 'fog', name: 'きり' }],
    { quiet: { state: 'complete', by_status: { pending: 1 } }, busy: { state: 'complete', by_status: { in_progress: 3, waiting: 1 } }, fog: { state: 'unavailable', by_status: null } },
  );
  assert.deepEqual(world.rows.map((row) => row.code), ['busy', 'quiet', 'fog']);
  assert.equal(world.rows[2].pulse, null);
  assert.equal(world.read, 2);
  assert.equal(world.active, 1);
});
