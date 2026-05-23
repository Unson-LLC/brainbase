# Spec: Xterm focus report sanitization

## Invariants

- INV-1: Terminal focus reports are terminal control responses, never user text.
- INV-2: `ESC[I`, `ESC[O`, bare `[I`, and bare `[O` must not be local-echoed in xterm.
- INV-3: `ESC[I`, `ESC[O`, bare `[I`, and bare `[O` must not be sent through WebSocket terminal input or legacy terminal IO.
- INV-4: Mixed text surrounding a focus report fragment must preserve its relative order after the fragment is removed.
- INV-5: Server-side sanitization must still drop focus-only messages even if a client regression sends them.
- INV-6: Existing terminal transport lifecycle branches are preserved: jsdom-only behavior remains a test-environment fallback, hidden disconnect reconnects retain session context, and pending startup shells reject terminal IO until runtime readiness.

## Contracts

- CON-1: `TerminalTransportClient.sendText()` sanitizes terminal control responses before local echo, batching, probe checks, or dispatch.
- CON-2: `TerminalTransportService._handleMessage()` sanitizes text input messages before input-ready checks and before routing to control-mode or terminal IO.
- CON-3: `sendInput()` in session runtime terminal IO strips focus reports before text normalization and returns early when nothing remains.
- CON-4: Sanitization applies to complete focus reports and to the observed bare fragments caused by ESC loss.
- CON-5: Focus report sanitization must not alter startup-shell gating, hidden-disconnect reconnect handling, or jsdom test-environment guards.

## Scenarios

- S-1: xterm emits `ESC[I` during focus recovery. Brainbase drops it and sends no terminal input.
- S-2: The active input path receives bare `[I`. Brainbase drops it and sends no terminal input.
- S-3: The active input path receives `hello[Iworld`. Brainbase sends `helloworld`.
- S-4: A client regression sends `[I` over the terminal WebSocket. The server ignores it.
- S-5: A client regression sends `hello ESC[O world` over the terminal WebSocket. The server sends `helloworld`.

## Anti-patterns

- AP-1: Treating focus reports as text that should be sent immediately.
- AP-2: Applying local echo before stripping focus report fragments.
- AP-3: Relying only on server-side stripping while the client can still render ghost text.

## Verification

- V-1: `npm run test:run -- tests/unit/terminal-transport-client.test.js`
- V-2: `npm run test:run -- tests/server/services/terminal-transport-service.test.js`
- V-3: `npm run test:run -- tests/unit/server-session-manager.test.js`
- V-4: `node --check public/modules/core/terminal-transport-client.js`
- V-5: `node --check server/services/terminal-transport-service.js`
- V-6: `node --check server/services/session-runtime/terminal-io-methods.js`
- V-7: `npm run test:e2e -- tests/e2e/story-xterm-focus-report-sanitize.spec.js`
- V-8: `node --check tests/e2e/story-xterm-focus-report-sanitize.spec.js`
- V-9: `vibepro pr prepare . --base origin/develop --story-id story-xterm-focus-report-sanitize`
