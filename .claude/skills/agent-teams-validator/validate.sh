#!/bin/bash

# Agent Teams Validator Script
# Usage: ./validate.sh [skill-path]
#
# Example:
#   ./validate.sh /Users/ksato/workspace/.claude/skills/ops-department

set -e

SKILL_PATH="${1:-.}"

if [ ! -f "$SKILL_PATH/SKILL.md" ]; then
  echo "ERROR: SKILL.md not found in $SKILL_PATH"
  exit 1
fi

cd "$SKILL_PATH"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Agent Teams Validator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Target: $(basename "$SKILL_PATH")"
echo ""

CHECKS_PASSED=0
CHECKS_FAILED=0

# Check 1: teammates: exists in SKILL.md
echo -n "✓ Check 1: teammates: exists in SKILL.md ... "
if grep -q "^teammates:" SKILL.md; then
  echo "✅ PASS"
  ((CHECKS_PASSED++))
else
  echo "🔴 FAIL (teammates: not found in frontmatter)"
  ((CHECKS_FAILED++))
fi

# Check 2: agents/ directory exists
echo -n "✓ Check 2: agents/ directory exists ... "
if [ -d "agents" ]; then
  agent_files_count=$(find agents -name "*.md" -type f | wc -l | tr -d ' ')
  teammates_count=$(grep -A 100 "^teammates:" SKILL.md | grep -c "  - name:" || echo 0)

  if [ "$teammates_count" -eq "$agent_files_count" ]; then
    echo "✅ PASS ($agent_files_count files)"
    ((CHECKS_PASSED++))
  else
    echo "🔴 FAIL (teammates: $teammates_count, agent files: $agent_files_count)"
    ((CHECKS_FAILED++))
  fi
else
  echo "🔴 FAIL (agents/ directory not found)"
  ((CHECKS_FAILED++))
fi

# Check 3: All agent names match teammates list
echo -n "✓ Check 3: All agent names match teammates list ... "
teammates_names=$(grep -A 100 "^teammates:" SKILL.md | grep "  - name:" | sed 's/.*name: //' | tr '\n' '|' | sed 's/|$//')

check3_failed=0
for file in agents/*.md; do
  agent_name=$(grep "^name:" "$file" | head -1 | sed 's/name: //')

  if ! echo "$agent_name" | grep -qE "^($teammates_names)$"; then
    echo "🔴 FAIL ($file: $agent_name not in teammates list)"
    ((CHECKS_FAILED++))
    check3_failed=1
    break
  fi
done

if [ "$check3_failed" -eq 0 ]; then
  echo "✅ PASS"
  ((CHECKS_PASSED++))
fi

# Check 4: No invalid suffixes
echo -n "✓ Check 4: No invalid suffixes (-teammate, -agent) ... "
check4_failed=0
for file in agents/*.md; do
  agent_name=$(grep "^name:" "$file" | head -1 | sed 's/name: //')

  if echo "$agent_name" | grep -qE -- "-(teammate|agent)$"; then
    echo "🔴 FAIL ($file has invalid suffix: $agent_name)"
    ((CHECKS_FAILED++))
    check4_failed=1
    break
  fi
done

if [ "$check4_failed" -eq 0 ]; then
  echo "✅ PASS"
  ((CHECKS_PASSED++))
fi

# Check 5: Filename patterns are correct
echo -n "✓ Check 5: Filename patterns are correct ... "
check5_failed=0
for file in agents/*.md; do
  basename_only=$(basename "$file" .md)
  agent_name=$(grep "^name:" "$file" | head -1 | sed 's/name: //')
  expected_name=$(echo "$basename_only" | tr '_' '-')

  if [ "$agent_name" != "$expected_name" ]; then
    echo "🔴 FAIL ($file: expected $expected_name, got $agent_name)"
    ((CHECKS_FAILED++))
    check5_failed=1
    break
  fi
done

if [ "$check5_failed" -eq 0 ]; then
  echo "✅ PASS"
  ((CHECKS_PASSED++))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$CHECKS_FAILED" -eq 0 ]; then
  echo "Result: ✅ PASSED ($CHECKS_PASSED/5 checks)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "Result: 🔴 FAILED ($CHECKS_PASSED passed, $CHECKS_FAILED failed)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
