# SNS mobile review terminal guard spec

## Clauses

### SNS-MOBILE-REVIEW-001

Given SNS Growth overlay is open on a mobile viewport, when the user taps a review card, then the selected post detail remains visible and the terminal stage remains hidden.

### SNS-MOBILE-REVIEW-002

Terminal focus and mobile live-terminal reveal logic must treat `terminal-stage: display none` as not visible, even if `console-area` itself is visible because a workspace overlay is mounted inside it.

### SNS-MOBILE-REVIEW-003

Mobile SNS mode must hide terminal-stage through CSS as a defense-in-depth guard, so terminal iframe or snapshot layers cannot receive pointer interaction behind the SNS overlay.

### SNS-MOBILE-REVIEW-004

Verification must include a mobile browser flow that opens SNS from Brainbase, taps a review card, and asserts that `openMobileLiveTerminal` was not called.

### SNS-MOBILE-REVIEW-005

Existing terminal session-switch guard branches, including switch token mismatch, non-current session, and stale session handling, must remain unchanged by this story.
