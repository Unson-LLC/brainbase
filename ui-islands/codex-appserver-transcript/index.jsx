import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    AssistantRuntimeProvider,
    ComposerPrimitive,
    ThreadPrimitive,
    useExternalStoreRuntime
} from '@assistant-ui/react';

const ROLE_KINDS = new Set(['user', 'assistant', 'system']);
const COMPACT_KINDS = new Set(['command', 'file_change', 'reasoning', 'tool', 'input_request', 'turn']);

function textFromAppendMessage(message) {
    return (message?.content || [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text || '')
        .join('\n')
        .trim();
}

function toAssistantMessage(item, index) {
    const kind = item?.kind || 'assistant';
    const role = ROLE_KINDS.has(kind) ? kind : 'assistant';
    const text = item?.text || '';
    const id = item?.id || `codex-appserver-${index}`;
    const createdAt = item?.createdAt ? new Date(item.createdAt) : new Date(0);
    const metadata = {
        custom: {
            codexKind: kind,
            rawStatus: item?.status || null
        }
    };

    if (role === 'user') {
        return {
            id,
            createdAt,
            role,
            content: [{ type: 'text', text }],
            attachments: [],
            metadata
        };
    }

    return {
        id,
        createdAt,
        role,
        content: [{ type: kind === 'reasoning' ? 'reasoning' : 'text', text }],
        status: kind === 'error'
            ? { type: 'incomplete', reason: 'error', error: text }
            : { type: 'complete', reason: 'stop' },
        metadata: {
            ...metadata,
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

function MessageBubble({ message }) {
    const kind = message?.metadata?.custom?.codexKind || message?.role || 'assistant';
    const text = (message?.content || [])
        .filter((part) => part?.type === 'text' || part?.type === 'reasoning')
        .map((part) => part.text || '')
        .join('\n');
    const isCompact = COMPACT_KINDS.has(kind);
    const label = kind.replaceAll('_', ' ');

    return (
        <article
            className={`codex-appserver-chat-message ${message.role} ${kind}${isCompact ? ' compact' : ''}`}
            data-codex-appserver-message-kind={kind}
            data-codex-appserver-message-id={message.id}
        >
            <div className="codex-appserver-chat-avatar" aria-hidden="true">
                {message.role === 'user' ? 'U' : kind === 'error' ? '!' : 'AI'}
            </div>
            <div className="codex-appserver-chat-bubble">
                <div className="codex-appserver-chat-meta">
                    <span>{label}</span>
                </div>
                <div className="codex-appserver-chat-text">{text || ' '}</div>
            </div>
        </article>
    );
}

function CodexAppServerTranscriptApp({ api, sessionId, threadId, initialStatus, initialSnapshot, autoLoad = true }) {
    const viewportRef = useRef(null);
    const [messages, setMessages] = useState(() => normalizeSnapshot(initialSnapshot));
    const [status, setStatus] = useState(initialSnapshot?.status || initialStatus || 'thread ready');
    const [currentThreadId, setCurrentThreadId] = useState(threadId || '');
    const [isLoading, setIsLoading] = useState(!initialSnapshot);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    const isSendingRef = useRef(false);

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

    useEffect(() => {
        const node = viewportRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [messages, isSending, error]);

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

    const messageCount = messages.length;
    const statusLabel = isSending ? 'running' : status;

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <section className="codex-appserver-chat-shell" data-codex-appserver-transcript-island>
                <header className="codex-appserver-chat-header">
                    <div className="codex-appserver-chat-title-group">
                        <span className="codex-appserver-chat-title">Codex App Server</span>
                        <span className="codex-appserver-chat-subtitle">Structured transcript</span>
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
                            ↻
                        </button>
                    </div>
                </header>
                <div className="codex-appserver-chat-context" aria-label="Session context">
                    <span>session</span>
                    <code>{sessionId}</code>
                    <span>thread</span>
                    <code>{currentThreadId || 'unavailable'}</code>
                </div>
                <ThreadPrimitive.Root className="codex-appserver-chat-thread">
                    <ThreadPrimitive.Viewport
                        className="codex-appserver-chat-viewport"
                        ref={viewportRef}
                        autoScroll
                        turnAnchor="bottom"
                    >
                        {isLoading && messageCount === 0 ? (
                            <div className="codex-appserver-chat-empty">Loading transcript...</div>
                        ) : messageCount === 0 ? (
                            <div className="codex-appserver-chat-empty">No transcript yet.</div>
                        ) : (
                            <ThreadPrimitive.Messages>
                                {({ message }) => <MessageBubble message={message} />}
                            </ThreadPrimitive.Messages>
                        )}
                        {error ? <div className="codex-appserver-chat-error" role="alert">{error}</div> : null}
                    </ThreadPrimitive.Viewport>
                    <ThreadPrimitive.ViewportFooter className="codex-appserver-chat-footer">
                        <ComposerPrimitive.Root className="codex-appserver-chat-composer">
                            <ComposerPrimitive.Input
                                className="codex-appserver-chat-input"
                                placeholder="Codex に依頼する"
                                submitMode="ctrlEnter"
                                rows={2}
                            />
                            <ComposerPrimitive.Send className="codex-appserver-chat-send">
                                {isSending ? 'Sending' : 'Send'}
                            </ComposerPrimitive.Send>
                        </ComposerPrimitive.Root>
                    </ThreadPrimitive.ViewportFooter>
                </ThreadPrimitive.Root>
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
