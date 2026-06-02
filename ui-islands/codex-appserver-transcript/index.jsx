import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    AssistantRuntimeProvider,
    useExternalStoreRuntime
} from '@assistant-ui/react';
import { Thread, makeMarkdownText } from '@assistant-ui/react-ui';
import assistantUiStyles from '@assistant-ui/react-ui/styles/index.css';
import assistantUiMarkdownStyles from '@assistant-ui/react-ui/styles/markdown.css';

const ROLE_KINDS = new Set(['user', 'assistant', 'system']);
const MarkdownText = makeMarkdownText();

function ensureAssistantUiStyles() {
    if (document.getElementById('brainbase-assistant-ui-native-styles')) return;
    const style = document.createElement('style');
    style.id = 'brainbase-assistant-ui-native-styles';
    style.textContent = `${assistantUiStyles}\n${assistantUiMarkdownStyles}\n${BRAINBASE_AUI_SHELL_STYLES}`;
    document.head.append(style);
}

function textFromAppendMessage(message) {
    return (message?.content || [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text || '')
        .join('\n')
        .trim();
}

function formatActivityText(item) {
    const kind = String(item?.kind || 'event').replaceAll('_', ' ');
    const status = item?.status ? ` (${item.status})` : '';
    const text = item?.text || '';
    return text ? `**${kind}${status}**\n\n${text}` : `**${kind}${status}**`;
}

function toAssistantMessage(item, index) {
    const kind = item?.kind || 'assistant';
    const role = ROLE_KINDS.has(kind) ? kind : 'assistant';
    const text = ROLE_KINDS.has(kind) ? (item?.text || '') : formatActivityText(item);
    const id = item?.id || `codex-appserver-${index}`;
    const createdAt = item?.createdAt ? new Date(item.createdAt) : new Date(0);

    if (role === 'user') {
        return {
            id,
            createdAt,
            role,
            content: [{ type: 'text', text }],
            attachments: [],
            metadata: { custom: { codexKind: kind, rawStatus: item?.status || null } }
        };
    }

    return {
        id,
        createdAt,
        role,
        content: [{ type: 'text', text }],
        status: kind === 'error'
            ? { type: 'incomplete', reason: 'error', error: text }
            : { type: 'complete', reason: 'stop' },
        metadata: {
            custom: { codexKind: kind, rawStatus: item?.status || null },
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: []
        }
    };
}

function normalizeSnapshot(snapshot) {
    const timeline = Array.isArray(snapshot?.timeline) ? snapshot.timeline : [];
    return timeline.map(toAssistantMessage);
}

function CodexAppServerTranscriptApp({ api, sessionId, threadId, initialStatus, initialSnapshot, autoLoad = true }) {
    const [messages, setMessages] = useState(() => normalizeSnapshot(initialSnapshot));
    const [status, setStatus] = useState(initialSnapshot?.status || initialStatus || 'thread ready');
    const [currentThreadId, setCurrentThreadId] = useState(threadId || '');
    const [isLoading, setIsLoading] = useState(!initialSnapshot);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    const isSendingRef = useRef(false);

    useEffect(() => {
        ensureAssistantUiStyles();
    }, []);

    const applySnapshot = useCallback((snapshot) => {
        setMessages(normalizeSnapshot(snapshot));
        setStatus(snapshot?.status || 'thread ready');
        if (snapshot?.threadId) setCurrentThreadId(snapshot.threadId);
    }, []);

    const loadTranscript = useCallback(async ({ silent = false } = {}) => {
        if (!api?.getTranscript) return;
        if (!silent) setIsLoading(true);
        try {
            const snapshot = await api.getTranscript();
            applySnapshot(snapshot);
            setError('');
        } catch (err) {
            setError(err?.message || 'Failed to load transcript');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [api, applySnapshot]);

    useEffect(() => {
        if (initialSnapshot) {
            applySnapshot(initialSnapshot);
            setIsLoading(false);
        }
    }, [initialSnapshot, applySnapshot]);

    useEffect(() => {
        if (autoLoad) loadTranscript();
    }, [autoLoad, loadTranscript, sessionId]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (!isSendingRef.current) loadTranscript({ silent: true });
        }, 1200);
        return () => window.clearInterval(timer);
    }, [loadTranscript]);

    const runtime = useExternalStoreRuntime({
        messages,
        isLoading,
        isDisabled: isLoading,
        isRunning: isSending,
        isSendDisabled: isSending || isLoading,
        onNew: async (message) => {
            const text = textFromAppendMessage(message);
            if (!text || !api?.startTurn) return;
            setIsSending(true);
            isSendingRef.current = true;
            setError('');
            try {
                const snapshot = await api.startTurn(text);
                applySnapshot(snapshot);
            } catch (err) {
                setError(err?.message || 'Failed to send turn');
            } finally {
                isSendingRef.current = false;
                setIsSending(false);
            }
        }
    });

    const threadConfig = useMemo(() => ({
        assistantAvatar: { fallback: 'BB' },
        welcome: { message: 'Codex App Server transcript' },
        composer: { allowAttachments: false },
        branchPicker: { allowBranchPicker: false },
        assistantMessage: {
            components: { Text: MarkdownText }
        },
        strings: {
            composer: {
                input: { placeholder: 'Codex に依頼する' },
                send: { tooltip: 'Send' }
            },
            assistantMessage: {
                copy: { tooltip: 'Copy' },
                reload: { tooltip: 'Reload' }
            },
            thread: {
                scrollToBottom: { tooltip: 'Scroll to bottom' }
            }
        }
    }), []);

    const statusLabel = isSending ? 'running' : status;

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <section className="codex-appserver-chat-shell" data-codex-appserver-transcript-island>
                <header className="codex-appserver-chat-header">
                    <div className="codex-appserver-chat-title-group">
                        <span className="codex-appserver-chat-title">Codex App Server</span>
                        <span className="codex-appserver-chat-subtitle">assistant-ui native thread</span>
                    </div>
                    <div className="codex-appserver-chat-status">
                        <span className="codex-appserver-chat-chip">{statusLabel}</span>
                        <button
                            type="button"
                            className="codex-appserver-chat-icon-button"
                            onClick={() => loadTranscript()}
                            disabled={isLoading || isSending}
                            title="Reload transcript"
                            aria-label="Reload transcript"
                        >
                            Reload
                        </button>
                    </div>
                </header>
                <div className="codex-appserver-chat-context" aria-label="Session context">
                    <span>session</span>
                    <code>{sessionId}</code>
                    <span>thread</span>
                    <code>{currentThreadId || 'unavailable'}</code>
                </div>
                <div className="codex-appserver-native-thread">
                    {isLoading && messages.length === 0 ? (
                        <div className="codex-appserver-chat-state">Loading transcript...</div>
                    ) : null}
                    <Thread {...threadConfig} />
                    {messages.length === 0 && !isLoading ? (
                        <div className="codex-appserver-chat-state codex-appserver-chat-state-empty">No transcript yet.</div>
                    ) : null}
                    {error ? <div className="codex-appserver-chat-error" role="alert">{error}</div> : null}
                </div>
            </section>
        </AssistantRuntimeProvider>
    );
}

const mountedRoots = new WeakMap();

export function mountCodexAppServerTranscript(rootElement, props) {
    if (!rootElement) return null;
    let root = mountedRoots.get(rootElement);
    if (!root) {
        root = createRoot(rootElement);
        mountedRoots.set(rootElement, root);
    }
    root.render(<CodexAppServerTranscriptApp {...props} />);
    return {
        update(nextProps) {
            root.render(<CodexAppServerTranscriptApp {...nextProps} />);
        },
        unmount() {
            root.unmount();
            mountedRoots.delete(rootElement);
        }
    };
}

window.BrainbaseCodexAppServerTranscript = {
    mount: mountCodexAppServerTranscript
};

const BRAINBASE_AUI_SHELL_STYLES = `
.codex-appserver-chat-shell {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  background: #0b0d10;
  color: #f2f5f8;
}
.codex-appserver-chat-header,
.codex-appserver-chat-context {
  flex: 0 0 auto;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}
.codex-appserver-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
}
.codex-appserver-chat-title-group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.codex-appserver-chat-title {
  color: #f8fafc;
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
}
.codex-appserver-chat-subtitle,
.codex-appserver-chat-context {
  color: #9aa4b2;
  font-size: 12px;
}
.codex-appserver-chat-status,
.codex-appserver-chat-context {
  display: flex;
  align-items: center;
  gap: 8px;
}
.codex-appserver-chat-chip {
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 999px;
  padding: 3px 8px;
  color: #8bf3b1;
  font-size: 12px;
}
.codex-appserver-chat-icon-button {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 6px;
  padding: 5px 8px;
  background: #151a21;
  color: #dbe4ee;
  font-size: 12px;
  cursor: pointer;
}
.codex-appserver-chat-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.codex-appserver-chat-context {
  min-width: 0;
  padding: 8px 18px;
  white-space: nowrap;
}
.codex-appserver-chat-context code {
  min-width: 0;
  overflow: hidden;
  color: #dbe4ee;
  text-overflow: ellipsis;
}
.codex-appserver-native-thread {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.codex-appserver-native-thread .aui-thread-root {
  height: 100%;
  background: #0b0d10;
  color: #f2f5f8;
}
.codex-appserver-native-thread .aui-thread-viewport {
  padding: 20px min(7vw, 72px);
}
.codex-appserver-native-thread .aui-thread-viewport-footer {
  background: linear-gradient(180deg, rgba(11, 13, 16, 0), #0b0d10 28%);
}
.codex-appserver-native-thread .aui-composer-root {
  border-color: rgba(148, 163, 184, 0.28);
  background: #10151b;
}
.codex-appserver-native-thread .aui-composer-input {
  color: #f2f5f8;
}
.codex-appserver-native-thread .aui-composer-input::placeholder {
  color: #8894a5;
}
.codex-appserver-native-thread .aui-user-message-content {
  background: #2563eb;
  color: #ffffff;
}
.codex-appserver-native-thread .aui-assistant-message-content {
  color: #e8eef7;
}
.codex-appserver-native-thread .aui-md-a {
  color: #93c5fd;
}
.codex-appserver-native-thread .aui-md-pre {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #080b0f;
}
.codex-appserver-chat-state {
  position: absolute;
  left: 50%;
  top: 28px;
  z-index: 1;
  transform: translateX(-50%);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(16, 21, 27, 0.92);
  color: #aeb8c5;
  font-size: 12px;
}
.codex-appserver-chat-state-empty {
  top: 76px;
}
.codex-appserver-chat-error {
  position: absolute;
  right: 18px;
  bottom: 86px;
  max-width: min(520px, calc(100% - 36px));
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(69, 10, 10, 0.92);
  color: #fecaca;
  font-size: 13px;
}
`;
