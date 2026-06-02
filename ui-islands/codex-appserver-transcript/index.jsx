import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    AssistantRuntimeProvider,
    ComposerPrimitive,
    MessagePrimitive,
    ThreadPrimitive,
    useExternalStoreRuntime
} from '@assistant-ui/react';

const ROLE_KINDS = new Set(['user', 'assistant', 'system']);
const COMPACT_KINDS = new Set(['command', 'file_change', 'reasoning', 'tool', 'input_request', 'turn']);
const ACTIVITY_KIND_CONFIG = {
    command: { icon: '$', label: 'Command', tone: 'neutral' },
    file_change: { icon: 'F', label: 'File change', tone: 'file' },
    reasoning: { icon: 'R', label: 'Reasoning', tone: 'reasoning' },
    tool: { icon: 'T', label: 'Tool', tone: 'tool' },
    input_request: { icon: '?', label: 'Input request', tone: 'input' },
    turn: { icon: '>', label: 'Turn', tone: 'neutral' },
    error: { icon: '!', label: 'Error', tone: 'error' },
    system: { icon: 'S', label: 'System', tone: 'neutral' }
};

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

function splitFencedCode(text) {
    const source = String(text || '').replace(/\r\n/g, '\n');
    const blocks = [];
    const pattern = /```([A-Za-z0-9_+.-]*)[ \t]*\n([\s\S]*?)```/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
        if (match.index > cursor) {
            blocks.push({ type: 'text', text: source.slice(cursor, match.index) });
        }
        blocks.push({ type: 'code', language: match[1] || 'text', code: match[2].replace(/\n$/, '') });
        cursor = pattern.lastIndex;
    }
    if (cursor < source.length) {
        blocks.push({ type: 'text', text: source.slice(cursor) });
    }
    return blocks.length ? blocks : [{ type: 'text', text: source }];
}

function InlineMarkdown({ text }) {
    const parts = [];
    const pattern = /(`([^`]+)`)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
        if (match.index > cursor) parts.push(text.slice(cursor, match.index));
        if (match[2]) {
            parts.push(<code key={`code-${match.index}`} className="codex-appserver-inline-code">{match[2]}</code>);
        } else if (match[3] && match[4]) {
            parts.push(
                <a
                    key={`link-${match.index}`}
                    className="codex-appserver-link"
                    href={match[4]}
                    target="_blank"
                    rel="noreferrer"
                >
                    {match[3]}
                </a>
            );
        }
        cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <>{parts.map((part, index) => typeof part === 'string' ? <React.Fragment key={`text-${index}`}>{part}</React.Fragment> : part)}</>;
}

function MarkdownText({ text }) {
    const lines = String(text || '').split('\n');
    const nodes = [];
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
        if (!paragraph.length) return;
        nodes.push(
            <p key={`p-${nodes.length}`} className="codex-appserver-markdown-paragraph">
                <InlineMarkdown text={paragraph.join(' ')} />
            </p>
        );
        paragraph = [];
    };
    const flushList = () => {
        if (!list) return;
        const Component = list.ordered ? 'ol' : 'ul';
        nodes.push(
            <Component key={`list-${nodes.length}`} className="codex-appserver-markdown-list">
                {list.items.map((item, index) => <li key={`${index}-${item}`}><InlineMarkdown text={item} /></li>)}
            </Component>
        );
        list = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }
        const unordered = line.match(/^\s*[-*]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (unordered || ordered) {
            flushParagraph();
            const orderedList = Boolean(ordered);
            if (!list || list.ordered !== orderedList) flushList();
            if (!list) list = { ordered: orderedList, items: [] };
            list.items.push((unordered?.[1] || ordered?.[1] || '').trim());
            continue;
        }
        flushList();
        paragraph.push(line.trim());
    }
    flushParagraph();
    flushList();
    if (!nodes.length) return <p className="codex-appserver-markdown-paragraph"> </p>;
    return <>{nodes}</>;
}

function CodeBlock({ language, code }) {
    const [copied, setCopied] = useState(false);
    const copyCode = useCallback(async () => {
        try {
            await navigator.clipboard?.writeText?.(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            setCopied(false);
        }
    }, [code]);

    return (
        <figure className="codex-appserver-code-block">
            <figcaption>
                <span>{language || 'text'}</span>
                <button type="button" onClick={copyCode} className="codex-appserver-copy-code">
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </figcaption>
            <pre><code>{code}</code></pre>
        </figure>
    );
}

function RichMessageContent({ text }) {
    const blocks = useMemo(() => splitFencedCode(text), [text]);
    return (
        <div className="codex-appserver-rich-text">
            {blocks.map((block, index) => block.type === 'code'
                ? <CodeBlock key={`code-${index}`} language={block.language} code={block.code} />
                : <MarkdownText key={`text-${index}`} text={block.text} />)}
        </div>
    );
}

function ActivityEvent({ kind, text, status }) {
    const config = ACTIVITY_KIND_CONFIG[kind] || { icon: 'i', label: kind.replaceAll('_', ' '), tone: 'neutral' };
    const isLong = text.length > 180 || text.includes('\n');
    return (
        <details
            className={`codex-appserver-activity ${config.tone}`}
            data-codex-appserver-activity-kind={kind}
            open={!isLong || kind === 'error'}
        >
            <summary>
                <span className="codex-appserver-activity-icon" aria-hidden="true">{config.icon}</span>
                <span className="codex-appserver-activity-title">{config.label}</span>
                {status ? <span className="codex-appserver-activity-status">{status}</span> : null}
                {isLong ? <span className="codex-appserver-activity-hint">Details</span> : null}
            </summary>
            <div className="codex-appserver-activity-body">
                <RichMessageContent text={text || ' '} />
            </div>
        </details>
    );
}

function MessageBubble({ message }) {
    const kind = message?.metadata?.custom?.codexKind || message?.role || 'assistant';
    const rawStatus = message?.metadata?.custom?.rawStatus || '';
    const text = (message?.content || [])
        .filter((part) => part?.type === 'text' || part?.type === 'reasoning')
        .map((part) => part.text || '')
        .join('\n');
    const isCompact = COMPACT_KINDS.has(kind);
    const isConversation = !isCompact && kind !== 'error';

    return (
        <MessagePrimitive.Root
            className={`codex-appserver-chat-message ${message.role} ${kind}${isCompact ? ' compact' : ''}${isConversation ? ' conversation' : ' activity-row'}`}
            data-codex-appserver-message-kind={kind}
            data-codex-appserver-message-id={message.id}
        >
            {isConversation ? (
                <>
                    <div className="codex-appserver-chat-avatar" aria-hidden="true">
                        {message.role === 'user' ? 'You' : 'BB'}
                    </div>
                    <div className="codex-appserver-chat-bubble">
                        <RichMessageContent text={text || ' '} />
                    </div>
                </>
            ) : (
                <ActivityEvent kind={kind} text={text || ' '} status={rawStatus} />
            )}
        </MessagePrimitive.Root>
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
                                submitMode="enter"
                                rows={1}
                                autoFocus
                                unstable_insertNewlineOnTouchEnter
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
