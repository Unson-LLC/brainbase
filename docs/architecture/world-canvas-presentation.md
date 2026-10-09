# Optional World canvas presentation

`createWorldView({ presentation: 'canvas', ... })` is the reusable OSS presentation for a full-size World. The default `standard` presentation continues to use the host header and rail. The feature marker is `WORLD_CANVAS_PRESENTATION_VERSION = 'brainbase.world-canvas.v1'`.

## Ownership and embedding

The host gives the root a definite available height and width, loads `world-view.css`, and supplies the existing authenticated fetcher plus `projectHref` and `taskHref` callbacks. Canvas mode ignores the optional external `rail`; it owns the toolbar, help, warning summaries, district drawer and selected-task bubble. The host must dispose the view when leaving World, but should not remount it for unrelated background updates.

The package remains the sole renderer implementation. A host serving an explicit asset allowlist must include the existing World files plus:

- `world-canvas-ui.js`
- `world-canvas-ui.css` (imported by `world-view.css`)
- `world-canvas-notes.js`

The World extension's `uiFiles` contains these assets. No fixture data, prototype storage or second task store is used. Existing per-viewer camera-independent visit snapshots remain convenience state; they are not business records.

## Interaction and accessibility

- Top-right controls return to the entire world, choose a city and select an icon-labelled sky mode. `auto`, `day`, `dusk` and `night` remain supported. Eight-pixel gaps and shared panel/toolbar left alignment use a 16px right inset (10px at narrow widths).
- City selection enters its district. The right edge opens complete existing city details, source times, links and task filters. Pointer movement to the panel has a close grace period; keyboard focus and touch can open the same edge. Hover does not move focus.
- A task selection opens nonmodal, scrollable details anchored to the actual selected lot's camera projection. The bubble follows pan/zoom and hides when the anchor is outside the viewport or camera clip range. It does not move the camera. A restored record with no drawable lot, a WebGL fallback record, or an explicit keyboard/touch task-directory selection is detached and labelled as record details, without an anchor pointer. The directory exposes every actually read task without moving the camera, including completed and cancelled records.
- Close and Escape dismiss overlays before navigating from task to city to world. Closing a task keeps its city and camera. URL selection uses the existing `world_business`/`world_site` replace-state contract.
- The bottom-left help control exposes the full actual legends and explanations in a compact sliding panel. Reduced motion removes panel animation. Full record text and original source/correction links remain available.
- Renderer, resize observers, view events and close timers are disposed together.

## Data semantics

Compact notices are explicit summaries of source states. Task `needs_check` remains a gap in recorded information, not proof of failure or stopped work. Partial, forbidden, failed, not-connected and missing source states remain separate from counts. Long explanations and timestamps remain in help and the existing rail.

Async work reads are guarded per business. A superseded response cannot reopen an old city or task. A visibility reread updates facts even if no growth event was detected. Failed rereads replace stale details with an explicit unavailable state; they do not retain old facts under a success label. Manual retry refreshes district geometry without resetting the camera. Only complete task reads can become a new growth comparison snapshot, preventing partial/failed reads from looking like removed work.

## Validation and release boundary

DOM tests exercise the actual read pipeline and canonical task projection. Scene-runtime tests use real THREE math with a mocked GPU renderer. These establish state and geometry contracts, not actual browser/WebGL visual acceptance.

Before rollout:

1. Review and merge the OSS change through normal repository checks. Do not assume a package was published just because this source was merged.
2. Publish a genuinely new package version containing this exact reviewed source using the repository release workflow, with authorization. This change does not bump or publish the package.
3. Verify the registry tarball's source marker, all World assets and integrity. The package's previous version cannot be republished with new content.
4. Update the organization host's exact dependency pin and lockfile to that real version; run its installed-package release gate and full CI. A source-override check is development evidence, not a production dependency pin.
5. Perform supported browser QA against the integrated host at desktop and mobile sizes, including hover gap, touch/keyboard, camera pan, source failures, late data, selection restoration and back/forward transitions.
6. Only after the host is reviewed and an authorized release is deployed, verify the running SHA and read-only canonical API data separately. HTTP health alone is not production completion.

Concurrent optional task-actor support is independent. The canvas presentation reuses the existing city/task rail builders and passes the complete projected site to the district, preserving their extension path; merging overlapping district changes still requires normal review.
