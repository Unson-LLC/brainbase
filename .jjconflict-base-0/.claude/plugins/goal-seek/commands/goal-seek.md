---
description: "Start Goal Seek loop in current session"
argument-hint: "GOAL [--criteria TEXT] [--max-iterations N]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-goal-seek.sh:*)"]
hide-from-slash-command-tool: "true"
---

# Goal Seek Command

Execute the setup script to initialize the Goal Seek loop:

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-goal-seek.sh" $ARGUMENTS
```

Please work on the goal. When you try to exit, the Goal Seek loop will feed the SAME GOAL back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate toward the goal.

CRITICAL RULE: You may ONLY output `<goal>COMPLETION_CRITERIA</goal>` when the goal is GENUINELY and COMPLETELY achieved. Do not output false completion statements to escape the loop, even if you think you're stuck or should exit. The loop is designed to continue until true goal achievement.

## Usage

```
/goal-seek [GOAL...] --criteria '<completion criteria>' [OPTIONS]
```

## Examples

```bash
/goal-seek Improve prediction accuracy to 70% --criteria 'Accuracy >= 70%' --max-iterations 30
/goal-seek Fix all failing tests --criteria 'All tests passing' --max-iterations 20
/goal-seek Refactor authentication module --criteria 'REFACTOR_COMPLETE' --max-iterations 15
```

## Options

- `--criteria '<text>'` - Completion criteria phrase (REQUIRED, USE QUOTES for multi-word)
- `--max-iterations <n>` - Maximum iterations before auto-stop (default: 50)
- `-h, --help` - Show help message

## Monitoring

```bash
# View current iteration
grep '^iteration:' .claude/goal-seek.local.md

# View full state
head -10 .claude/goal-seek.local.md
```
