import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/modules/core/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue({ success: true, errors: [] })
  },
  EVENTS: {
    SESSION_UPDATED: 'session:updated'
  }
}));

vi.mock('../../public/modules/toast.js', () => ({
  showError: vi.fn(),
  showInfo: vi.fn()
}));

import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';
import { getSessionStatus, markDoneAsRead, pollSessionStatus } from '../../public/modules/session-indicators.js';

describe('session-indicators', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div class="session-child-row" data-id="session-1">
        <span class="drag-handle"></span>
      </div>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    await pollSessionStatus('session-1');
  });

  it('markDoneAsRead呼び出し時_緑インジケータが即時クリアされる', async () => {
    const fetchMock = vi.fn((input) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (url === '/api/sessions/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            'session-1': {
              isWorking: false,
              isDone: true,
              lastWorkingAt: 0,
              lastDoneAt: 100,
              timestamp: 100
            }
          })
        });
      }
      if (url === '/api/sessions/session-1/clear-done') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    globalThis.fetch = fetchMock;

    await pollSessionStatus('session-2');
    expect(getSessionStatus('session-1').isDone).toBe(true);
    expect(document.querySelector('.session-activity-indicator.done')).toBeTruthy();

    await markDoneAsRead('session-1', 'session-2');

    expect(getSessionStatus('session-1').isDone).toBe(false);
    expect(document.querySelector('.session-activity-indicator.done')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/clear-done', { method: 'POST' });
    expect(eventBus.emit).toHaveBeenCalledWith(
      EVENTS.SESSION_UPDATED,
      expect.objectContaining({ sessionId: 'session-1' })
    );
  });

  it('pollSessionStatus呼び出し時_currentSessionでも緑インジケータを表示する', async () => {
    const fetchMock = vi.fn((input) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (url === '/api/sessions/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            'session-1': {
              isWorking: false,
              isDone: true,
              lastWorkingAt: 0,
              lastDoneAt: 300,
              timestamp: 300
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    globalThis.fetch = fetchMock;

    await pollSessionStatus('session-1');

    expect(getSessionStatus('session-1').isDone).toBe(true);
    expect(document.querySelector('.session-activity-indicator.done')).toBeTruthy();
  });

  it('markDoneAsRead呼び出し時_API失敗しても例外を投げない', async () => {
    const fetchMock = vi.fn((input) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (url === '/api/sessions/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            'session-1': {
              isWorking: false,
              isDone: true,
              lastWorkingAt: 0,
              lastDoneAt: 200,
              timestamp: 200
            }
          })
        });
      }
      if (url === '/api/sessions/session-1/clear-done') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    globalThis.fetch = fetchMock;

    await pollSessionStatus('session-2');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(markDoneAsRead('session-1', 'session-2')).resolves.toBeUndefined();

    expect(getSessionStatus('session-1').isDone).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('pollSessionStatus呼び出し時_statusから消えたsessionはclient mapから除去される', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'session-1': {
            isWorking: true,
            isDone: false,
            lastWorkingAt: 100,
            lastDoneAt: 0,
            timestamp: 100
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

    await pollSessionStatus('session-1');
    expect(getSessionStatus('session-1').isWorking).toBe(true);
    expect(document.querySelector('.session-activity-indicator.working')).toBeTruthy();

    await pollSessionStatus('session-1');
    expect(getSessionStatus('session-1')).toBeUndefined();
    expect(document.querySelector('.session-activity-indicator')).toBeNull();
  });

  it('pollSessionStatus繰り返し時_DOM再生成後もworkingインジケータを維持する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'session-1': {
          isWorking: true,
          isDone: false,
          lastWorkingAt: 200,
          lastDoneAt: 0,
          timestamp: 200
        }
      })
    });
    globalThis.fetch = fetchMock;

    await pollSessionStatus('session-1');
    expect(document.querySelector('.session-activity-indicator.working')).toBeTruthy();

    document.body.innerHTML = `
      <div class="session-child-row" data-id="session-1">
        <span class="drag-handle"></span>
      </div>
    `;

    await pollSessionStatus('session-1');
    expect(document.querySelector('.session-activity-indicator.working')).toBeTruthy();
  });
});
