#!/bin/bash

# Goal Seek Stop Hook
# Prevents session exit when a goal-seek is active
# Feeds Claude's output back as input to continue the loop

set -euo pipefail

# Read hook input from stdin (advanced stop hook API)
HOOK_INPUT=$(cat)

# Check if goal-seek is active
GOAL_STATE_FILE=".claude/goal-seek.local.md"

if [[ ! -f "$GOAL_STATE_FILE" ]]; then
  # No active goal seek - allow exit
  exit 0
fi

# Parse markdown frontmatter (YAML between ---) and extract values
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$GOAL_STATE_FILE")
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed 's/iteration: *//')
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed 's/max_iterations: *//')
# Extract completion_criteria and strip surrounding quotes if present
COMPLETION_CRITERIA=$(echo "$FRONTMATTER" | grep '^completion_criteria:' | sed 's/completion_criteria: *//' | sed 's/^"\(.*\)"$/\1/')

# Validate numeric fields before arithmetic operations
if [[ ! "$ITERATION" =~ ^[0-9]+$ ]]; then
  echo "⚠️  Goal Seek: State file corrupted" >&2
  echo "   File: $GOAL_STATE_FILE" >&2
  echo "   Problem: 'iteration' field is not a valid number (got: '$ITERATION')" >&2
  echo "" >&2
  echo "   Goal Seek is stopping. Run /goal-seek again to start fresh." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

if [[ ! "$MAX_ITERATIONS" =~ ^[0-9]+$ ]]; then
  echo "⚠️  Goal Seek: State file corrupted" >&2
  echo "   File: $GOAL_STATE_FILE" >&2
  echo "   Problem: 'max_iterations' field is not a valid number (got: '$MAX_ITERATIONS')" >&2
  echo "" >&2
  echo "   Goal Seek is stopping. Run /goal-seek again to start fresh." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Check if max iterations reached
if [[ $MAX_ITERATIONS -gt 0 ]] && [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
  echo "🛑 Goal Seek: Max iterations ($MAX_ITERATIONS) reached."
  echo "   Goal may not have been achieved. Consider:"
  echo "     • Breaking down the goal into smaller steps"
  echo "     • Adjusting the completion criteria"
  echo "     • Increasing max-iterations"
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Get transcript path from hook input
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "⚠️  Goal Seek: Transcript file not found" >&2
  echo "   Expected: $TRANSCRIPT_PATH" >&2
  echo "   Goal Seek is stopping." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Read last assistant message from transcript (JSONL format - one JSON per line)
# First check if there are any assistant messages
if ! grep -q '"role":"assistant"' "$TRANSCRIPT_PATH"; then
  echo "⚠️  Goal Seek: No assistant messages found in transcript" >&2
  echo "   Transcript: $TRANSCRIPT_PATH" >&2
  echo "   Goal Seek is stopping." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Extract last assistant message with explicit error handling
LAST_LINE=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -1)
if [[ -z "$LAST_LINE" ]]; then
  echo "⚠️  Goal Seek: Failed to extract last assistant message" >&2
  echo "   Goal Seek is stopping." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Parse JSON with error handling
LAST_OUTPUT=$(echo "$LAST_LINE" | jq -r '
  .message.content |
  map(select(.type == "text")) |
  map(.text) |
  join("\n")
' 2>&1)

# Check if jq succeeded
if [[ $? -ne 0 ]]; then
  echo "⚠️  Goal Seek: Failed to parse assistant message JSON" >&2
  echo "   Error: $LAST_OUTPUT" >&2
  echo "   Goal Seek is stopping." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

if [[ -z "$LAST_OUTPUT" ]]; then
  echo "⚠️  Goal Seek: Assistant message contained no text content" >&2
  echo "   Goal Seek is stopping." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Check for completion criteria
if [[ -n "$COMPLETION_CRITERIA" ]]; then
  # Extract text from <goal> tags using Perl for multiline support
  GOAL_TEXT=$(echo "$LAST_OUTPUT" | perl -0777 -pe 's/.*?<goal>(.*?)<\/goal>.*/$1/s; s/^\s+|\s+$//g; s/\s+/ /g' 2>/dev/null || echo "")

  # Use = for literal string comparison (not pattern matching)
  if [[ -n "$GOAL_TEXT" ]] && [[ "$GOAL_TEXT" = "$COMPLETION_CRITERIA" ]]; then
    echo "✅ Goal Seek: Goal achieved! Detected <goal>$COMPLETION_CRITERIA</goal>"
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "🎉 Goal Achievement Summary"
    echo "═══════════════════════════════════════════════════════════"
    echo "Goal: $(awk '/^---$/{i++; next} i>=2' "$GOAL_STATE_FILE")"
    echo "Iterations: $ITERATION"
    echo "Completion criteria: $COMPLETION_CRITERIA"
    echo "═══════════════════════════════════════════════════════════"
    rm "$GOAL_STATE_FILE"
    exit 0
  fi
fi

# Not complete - continue loop with SAME GOAL
NEXT_ITERATION=$((ITERATION + 1))

# Extract goal text (everything after the closing ---)
GOAL_TEXT=$(awk '/^---$/{i++; next} i>=2' "$GOAL_STATE_FILE")

if [[ -z "$GOAL_TEXT" ]]; then
  echo "⚠️  Goal Seek: State file corrupted or incomplete" >&2
  echo "   File: $GOAL_STATE_FILE" >&2
  echo "   Problem: No goal text found" >&2
  echo "   Goal Seek is stopping. Run /goal-seek again to start fresh." >&2
  rm "$GOAL_STATE_FILE"
  exit 0
fi

# Update iteration in frontmatter
TEMP_FILE="${GOAL_STATE_FILE}.tmp.$$"
sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$GOAL_STATE_FILE" > "$TEMP_FILE"
mv "$TEMP_FILE" "$GOAL_STATE_FILE"

# Build system message with iteration count and progress context
SYSTEM_MSG="🎯 Goal Seek iteration $NEXT_ITERATION/$MAX_ITERATIONS | Review your progress in files/git log. To complete: output <goal>$COMPLETION_CRITERIA</goal> (ONLY when goal is TRULY achieved!)"

# Add context about current repository state
REPO_CONTEXT=""
if git rev-parse --git-dir > /dev/null 2>&1; then
  REPO_CONTEXT="

Current repository state:
$(git status --short 2>/dev/null || echo "No changes")

Recent changes (last 3 commits):
$(git log --oneline -3 2>/dev/null || echo "No commits yet")
"
fi

# Output JSON to block the stop and feed goal back
jq -n \
  --arg goal "$GOAL_TEXT" \
  --arg msg "$SYSTEM_MSG" \
  --arg context "$REPO_CONTEXT" \
  '{
    "decision": "block",
    "reason": ($goal + $context),
    "systemMessage": $msg
  }'

# Exit 0 for successful hook execution
exit 0
