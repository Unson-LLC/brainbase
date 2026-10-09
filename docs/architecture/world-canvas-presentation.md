# Optional World canvas presentation

`createWorldView({ presentation: 'canvas', ... })` is the reusable OSS presentation for a full-size World. The default `standard` presentation continues to use the host header and rail. The feature marker is `WORLD_CANVAS_PRESENTATION_VERSION = 'brainbase.world-canvas.v1'`.

## Ownership and embedding

The host gives the root a definite available height and width, loads `world-view.css`, and supplies the existing authenticated fetcher plus `projectHref` and `taskHref` callbacks. Canvas mode ignores the optional external `rail`; it owns the toolbar, help, warning summaries, district drawer and selected-task bubble. The host must dispose the view when leaving World, but should not remount it for unrelated background updates.

The package remains the sole renderer implementation. A host serving an explicit asset allowlist must include the existing World files plus:

- `world-canvas-ui.js`
- `world-canvas-ui.css` (imported by `world-view.css`)
- `world-canvas-notes.js`
- `world-exits.js` (the tools of a business; imported by `world-view.js` and `world-district.js`)

The World extension's `uiFiles` contains these assets. No fixture data, prototype storage or second task store is used. Existing per-viewer camera-independent visit snapshots remain convenience state; they are not business records.

## Interaction and accessibility

- Top-right controls return to the entire world, choose a city and select an icon-labelled sky mode. `auto`, `day`, `dusk` and `night` remain supported. Eight-pixel gaps and shared panel/toolbar left alignment use a 16px right inset (10px at narrow widths).
- City selection enters its district. The right edge opens complete existing city details, source times, links and task filters. Pointer movement to the panel has a close grace period; keyboard focus and touch can open the same edge. Hover does not move focus.
- A task selection opens nonmodal, scrollable details anchored to the actual selected lot's camera projection. The bubble follows pan/zoom and hides when the anchor is outside the viewport or camera clip range. It does not move the camera. A restored record with no drawable lot, a WebGL fallback record, or an explicit keyboard/touch task-directory selection is detached and labelled as record details, without an anchor pointer. The directory exposes every actually read task without moving the camera, including completed and cancelled records.
- WebGL is used only when the browser can create it with `failIfMajorPerformanceCaveat: true`. A browser that would draw WebGL only in software (no GPU) builds the scene slowly enough to freeze the page for tens of seconds, so it gets the list with the reason "3D表示が遅い環境・一覧表示", like a browser with no WebGL at all.
- Close and Escape dismiss overlays before navigating from task to city to world. Closing a task keeps its city and camera. URL selection uses the existing `world_business`/`world_site` replace-state contract.
- The bottom-left help control exposes the full actual legends and explanations in a compact sliding panel. Reduced motion removes panel animation. Full record text and original source/correction links remain available.
- Renderer, resize observers, view events and close timers are disposed together.

## Data semantics

Compact notices are explicit summaries of source states. Task `needs_check` remains a gap in recorded information, not proof of failure or stopped work. Partial, forbidden, failed, not-connected and missing source states remain separate from counts. Long explanations and timestamps remain in help and the existing rail.

Async work reads are guarded per business. A superseded response cannot reopen an old city or task. A visibility reread updates facts even if no growth event was detected. Failed rereads replace stale details with an explicit unavailable state; they do not retain old facts under a success label. Manual retry refreshes district geometry without resetting the camera. Only complete task reads can become a new growth comparison snapshot, preventing partial/failed reads from looking like removed work.

## Tools of a business (optional `businessExits`)

`createWorldView({ businessExits })` (story-world-business-exits-v1) lets a host give the tools a business uses. `businessExits(business)` may return a promise of `{ status: 'complete'|'partial'|'failed'|'not_connected', read_at?, reason?, exits }`; each exit has `id`, `label`, `href`, `state` (`available`, `restricted`, `unknown`, `unavailable`) and optional `note`, `action: { label, href }` and `attention: { count?, label?, as_of? }`. The world does not know organizations, members, roles or requests: `state` and `action` are whatever the host decided, and a single owner can pass the same callback.

- Links: only `https:` URLs (new tab, `rel="noopener noreferrer"`) and links inside the host starting with a single `/` or `?` (same tab) are drawn. Anything else, a missing id/label or a repeated id drops the tool; a bad `action.href` drops only the action. Both are counted in the section. An unknown `state` is drawn as `unknown`, never as usable.
- Details: a 「この事業の道具」 section follows the existing city sections in the canvas drawer and the standard rail. `failed` and `not_connected` say 「道具を読めません（0件とは確認できません）」 with the reason; `partial` says it was read in part; only a complete read of zero says none are registered. A missing or non-numeric `attention.count` is 「件数は未確認」, never 0.
- Words: the state words come from the vocabulary's `exit_states` (`--world-vocabulary` file key `exit_states`, defaults 使える・権限が必要・未確認・読めない), the same mechanism as kinds and statuses.
- Stations: inside a district, each read tool stands as a station in a yard outside the gate, to its right (rows of four). Lit lamp = `available`; a closed striped wicket = `restricted`; fog = `unknown` and `unavailable`. The sign label carries the attention count (or 件数未確認). Picking a station selects its row in the city details (the canvas drawer opens); it never navigates. The yard is reserved, and its legend shown (canvas help, standard district legend), only when `businessExits` is given. Stations stand only where the district can be entered: a host whose task store is `not_connected` shows the section without stations.
- Reads: one call per business, kept for the view's life; a late answer for a city that is no longer open updates the cache but does not reopen that city's details or stations. Without 3D the list asks every business and shows the same section under each. The answer is copied, never changed.
- Without `businessExits` the DOM, the district scene and the legends are unchanged.

## Validation and release boundary

DOM tests exercise the actual read pipeline and canonical task projection. Scene-runtime tests use real THREE math with a mocked GPU renderer. These establish state and geometry contracts, not actual browser/WebGL visual acceptance.

Before rollout:

1. Review and merge the OSS change through normal repository checks. Do not assume a package was published just because this source was merged.
2. Publish a genuinely new package version containing this exact reviewed source using the repository release workflow, with authorization. This candidate prepares version 0.23.8. Its authorized merge triggers the existing validation/publication workflow; registry readback, not merge alone, establishes publication.
3. Verify the registry tarball's source marker, all World assets and integrity. The package's previous version cannot be republished with new content.
4. Update the organization host's exact dependency pin and lockfile to that real version; run its installed-package release gate and full CI. A source-override check is development evidence, not a production dependency pin.
5. Perform supported browser QA against the integrated host at desktop and mobile sizes, including hover gap, touch/keyboard, camera pan, source failures, late data, selection restoration and back/forward transitions.
6. Only after the host is reviewed and an authorized release is deployed, verify the running SHA and read-only canonical API data separately. HTTP health alone is not production completion.

Concurrent optional task-actor support is independent. The canvas presentation reuses the existing city/task rail builders and passes the complete projected site to the district, preserving their extension path; merging overlapping district changes still requires normal review.
