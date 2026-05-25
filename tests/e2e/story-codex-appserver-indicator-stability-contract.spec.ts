import { EventEmitter } from 'node:events';
import { expect, test } from '@playwright/test';

import { CodexAppServerActivityBridge } from '../../server/services/codex-app-server-activity-bridge.js';
import { createSessionServices } from '../../server/services/create-session-services.js';

// story-codex-appserver-indicator-stability ac:1
// story-codex-appserver-indicator-stability ac:2
// story-codex-appserver-indicator-stability ac:3
// story-codex-appserver-indicator-stability ac:4
// story-codex-appserver-indicator-stability ac:5
// story-codex-appserver-indicator-stability ac:6
// story-codex-appserver-indicator-stability ac:7
// story-codex-appserver-indicator-stability ac:8

function createStateStore() {
  let state = {
    sessions: [{
      id: 'session-codex-appserver',
      name: 'Codex App Server Story',
      engine: 'codex',
      intendedState: 'active'
    }]
  };

  return {
    get: () => state,
    update: async (next: typeof state) => {
      state = next;
      return state;
    },
    patchSession: async (sessionId: string, updates: Record<string, unknown>) => {
      state = {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, ...updates } : session
        )
      };
      return state.sessions.find((session) => session.id === sessionId);
    }
  };
}

test('story-codex-appserver-indicator-stability acceptance contract', () => {
  const adapter = new EventEmitter();
  const broadcasts: Array<{ sessionId: string; hookStatus: Record<string, unknown> }> = [];
  const services = createSessionServices({ stateStore: createStateStore() });
  services.shared._listTmuxPaneTitles = () => [];
  services.shared._activityWsBroadcast = (sessionId: string, hookStatus: Record<string, unknown>) => {
    broadcasts.push({ sessionId, hookStatus });
  };

  const bridge = new CodexAppServerActivityBridge({
    adapter,
    activityService: services.activity,
    now: () => Date.now(),
    logger: { debug: () => {}, error: () => {} }
  });

  bridge.attach();
  adapter.emit('notification', {
    method: 'turn/started',
    params: {
      sessionId: 'session-codex-appserver',
      turn: { id: 'turn_story_appserver' }
    }
  });

  const started = services.activity.getSessionStatus()['session-codex-appserver'];
  expect(started).toMatchObject({
    state: 'starting',
    isWorking: true,
    activeTurnCount: 1,
    liveActivity: {
      currentStep: 'Codex App Serverで作業開始',
      latestEvidence: 'codex app-server notification'
    }
  });
  expect(services.shared.hookStatus.get('session-codex-appserver').activeTurnIds).toEqual(['turn_story_appserver']);

  adapter.emit('notification', {
    method: 'turn/completed',
    params: {
      sessionId: 'session-codex-appserver',
      turn: { id: 'turn_story_appserver' }
    }
  });

  const completed = services.activity.getSessionStatus()['session-codex-appserver'];
  expect(completed).toMatchObject({
    state: 'done-unread',
    isWorking: false,
    activeTurnCount: 0,
    liveActivity: {
      currentStep: 'Codex App Serverのターンが完了',
      latestEvidence: 'codex app-server notification'
    }
  });
  expect(services.shared.hookStatus.get('session-codex-appserver').activeTurnIds).toEqual([]);
  expect(broadcasts).toHaveLength(2);

  adapter.emit('notification', {
    method: 'turn/started',
    params: { turn: { id: 'turn_missing_session' } }
  });
  expect(broadcasts).toHaveLength(2);
});
