#!/bin/bash

# Goal Seek Setup Script
# Creates state file for in-session Goal Seek loop

set -euo pipefail

# Parse arguments
GOAL_PARTS=()
MAX_ITERATIONS=50
COMPLETION_CRITERIA=""

# Parse options and positional arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      cat << 'HELP_EOF'
Goal Seek - Interactive goal achievement loop for brainbase

USAGE:
  /goal-seek [GOAL...] [OPTIONS]

ARGUMENTS:
  GOAL...    Goal description to achieve (can be multiple words without quotes)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: 50)
  --criteria '<text>'            Completion criteria phrase (USE QUOTES for multi-word)
  -h, --help                     Show this help message

DESCRIPTION:
  Starts a Goal Seek loop in your CURRENT session. The stop hook prevents
  exit and feeds your goal back as input until completion or iteration limit.

  To signal completion, you must output: <goal>YOUR_CRITERIA</goal>

  Use this for:
  - Achieving specific goals (e.g., "Improve prediction accuracy to 70%")
  - Iterative development until tests pass
  - Self-correcting implementations

EXAMPLES:
  /goal-seek Improve prediction accuracy to 70% --criteria 'Accuracy >= 70%' --max-iterations 30
  /goal-seek Fix all failing tests --criteria 'All tests passing' --max-iterations 20
  /goal-seek Refactor authentication module --criteria 'REFACTOR_COMPLETE' --max-iterations 15

STOPPING:
  Only by reaching --max-iterations or detecting --criteria
  Cannot be stopped manually!

MONITORING:
  # View current iteration:
  grep '^iteration:' .claude/goal-seek.local.md

  # View full state:
  head -10 .claude/goal-seek.local.md
HELP_EOF
      exit 0
      ;;
    --max-iterations)
      if [[ -z "${2:-}" ]]; then
        echo "❌ Error: --max-iterations requires a number argument" >&2
        exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]+$ ]]; then
        echo "❌ Error: --max-iterations must be a positive integer, got: $2" >&2
        exit 1
      fi
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --criteria)
      if [[ -z "${2:-}" ]]; then
        echo "❌ Error: --criteria requires a text argument" >&2
        echo "" >&2
        echo "   Valid examples:" >&2
        echo "     --criteria 'Accuracy >= 70%'" >&2
        echo "     --criteria 'All tests passing'" >&2
        echo "     --criteria 'GOAL_ACHIEVED'" >&2
        exit 1
      fi
      COMPLETION_CRITERIA="$2"
      shift 2
      ;;
    *)
      # Non-option argument - collect all as goal parts
      GOAL_PARTS+=("$1")
      shift
      ;;
  esac
done

# Join all goal parts with spaces
GOAL="${GOAL_PARTS[*]}"

# Validate goal is non-empty
if [[ -z "$GOAL" ]]; then
  echo "❌ Error: No goal provided" >&2
  echo "" >&2
  echo "   Goal Seek needs a goal description to work on." >&2
  echo "" >&2
  echo "   Examples:" >&2
  echo "     /goal-seek Improve prediction accuracy to 70%" >&2
  echo "     /goal-seek Fix all failing tests --max-iterations 20" >&2
  echo "" >&2
  echo "   For all options: /goal-seek --help" >&2
  exit 1
fi

# Validate completion criteria
if [[ -z "$COMPLETION_CRITERIA" ]]; then
  echo "❌ Error: --criteria is required" >&2
  echo "" >&2
  echo "   You must specify completion criteria." >&2
  echo "" >&2
  echo "   Examples:" >&2
  echo "     --criteria 'Accuracy >= 70%'" >&2
  echo "     --criteria 'All tests passing'" >&2
  echo "     --criteria 'GOAL_ACHIEVED'" >&2
  exit 1
fi

# Create state file for stop hook (markdown with YAML frontmatter)
mkdir -p .claude

# Quote completion criteria for YAML if it contains special chars
COMPLETION_CRITERIA_YAML="\"$COMPLETION_CRITERIA\""

cat > .claude/goal-seek.local.md <<EOF
---
active: true
iteration: 1
max_iterations: $MAX_ITERATIONS
completion_criteria: $COMPLETION_CRITERIA_YAML
started_at: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
---

$GOAL
EOF

# Output setup message
cat <<EOF
🎯 Goal Seek activated in this session!

Goal: $GOAL
Iteration: 1
Max iterations: $MAX_ITERATIONS
Completion criteria: $COMPLETION_CRITERIA (ONLY output when TRUE!)

The stop hook is now active. When you try to exit, the SAME GOAL will be
fed back to you. You'll see your previous work in files, creating a
self-referential loop where you iteratively work toward the goal.

To monitor: head -10 .claude/goal-seek.local.md

⚠️  WARNING: This loop cannot be stopped manually! It will run until
    you achieve the goal or reach max iterations.

🎯
EOF

# Output the initial goal if provided
if [[ -n "$GOAL" ]]; then
  echo ""
  echo "$GOAL"
fi

# Display completion criteria requirements
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "CRITICAL - Goal Seek Completion Criteria"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "To complete this Goal Seek, output this EXACT text:"
echo "  <goal>$COMPLETION_CRITERIA</goal>"
echo ""
echo "STRICT REQUIREMENTS (DO NOT VIOLATE):"
echo "  ✓ Use <goal> XML tags EXACTLY as shown above"
echo "  ✓ The statement MUST be completely and unequivocally TRUE"
echo "  ✓ Do NOT output false statements to exit the loop"
echo "  ✓ Verify the goal is achieved before outputting the criteria"
echo ""
echo "IMPORTANT - Goal achievement verification:"
echo "  Before outputting the completion criteria, you MUST:"
echo "    • Run tests if applicable"
echo "    • Verify metrics if quantitative goal"
echo "    • Check all acceptance criteria"
echo "    • Confirm the goal is GENUINELY achieved"
echo ""
echo "  Do not lie to exit the loop. Trust the iterative process."
echo "═══════════════════════════════════════════════════════════"
