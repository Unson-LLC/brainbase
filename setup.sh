#!/bin/bash
# Brainbase Initial Setup Script
# This script sets up the necessary files for first-time users

set -e

echo "🧠 Brainbase Initial Setup"
echo "=========================="
echo ""

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${BRAINBASE_ROOT:-$REPO_ROOT/data}"
VAR_DIR="${BRAINBASE_VAR_DIR:-$REPO_ROOT/var}"
STATE_FILE="$VAR_DIR/state.json"

# Check if already initialized
if [ -f "$STATE_FILE" ]; then
    echo "⚠️  state.json already exists. Skipping initialization."
    echo "   If you want to reset, run: rm \"$STATE_FILE\" && ./setup.sh"
    exit 0
fi

# Check and setup Jujutsu (required for AI-first session management)
echo "🥋 Checking Jujutsu..."
if command -v jj &> /dev/null; then
    echo "   ✅ Jujutsu is installed: $(jj version 2>&1 | head -1)"

    # Check if .jj exists and is valid
    if [ -d "$REPO_ROOT/.jj" ]; then
        # Validate .jj directory structure
        if [ ! -d "$REPO_ROOT/.jj/repo" ] || [ ! -f "$REPO_ROOT/.jj/repo/store" ]; then
            echo "   ⚠️  Incomplete .jj directory detected. Removing and reinitializing..."
            rm -rf "$REPO_ROOT/.jj"
        fi
    fi

    # Initialize Jujutsu if not already done or was removed
    if [ ! -d "$REPO_ROOT/.jj" ]; then
        echo "   📦 Initializing Jujutsu in this repository..."
        cd "$REPO_ROOT"
        if jj git init --colocate 2>/dev/null; then
            echo "   ✅ Jujutsu initialized"

            # Configure user if Git config exists
            GIT_USER_NAME=$(git config user.name 2>/dev/null)
            GIT_USER_EMAIL=$(git config user.email 2>/dev/null)
            if [ -n "$GIT_USER_NAME" ] && [ -n "$GIT_USER_EMAIL" ]; then
                jj config set --user user.name "$GIT_USER_NAME"
                jj config set --user user.email "$GIT_USER_EMAIL"
                echo "   ✅ Jujutsu user configured from Git settings"
            fi
        else
            echo "   ❌ Failed to initialize Jujutsu"
        fi
    else
        echo "   ✅ Jujutsu already initialized"
    fi
else
    echo "   ⚠️  Jujutsu (jj) is not installed"
    echo ""
    echo "   Jujutsu is required for AI-first session management."
    echo "   Install now? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        if command -v brew &> /dev/null; then
            echo "   📦 Installing Jujutsu via Homebrew..."
            brew install jj
            # Recursively call this section after install
            exec "$0"
        else
            echo "   ❌ Homebrew not found. Please install manually:"
            echo "      macOS: brew install jj"
            echo "      Linux: cargo install jj-cli"
        fi
    else
        echo "   Note: You can install later with: brew install jj"
        echo "   Then run: jj git init --colocate"
    fi
fi
echo ""

# Ensure local data/runtime dirs exist
mkdir -p "$DATA_DIR" "$VAR_DIR"

# Create state.json from sample
echo "📝 Creating state.json from state.sample.json..."
# Replace placeholder paths with actual repository path
sed "s|/path/to/brainbase|$REPO_ROOT|g" "$REPO_ROOT/state.sample.json" > "$STATE_FILE.tmp"

# Remove sample sessions and keep only brainbase session
cat > "$STATE_FILE" <<EOF
{
  "schemaVersion": 3,
  "lastOpenTaskId": null,
  "filters": {},
  "readNotifications": [],
  "focusSession": null,
  "sessions": [
    {
      "id": "brainbase",
      "name": "brainbase",
      "icon": "brain",
      "path": "$REPO_ROOT",
      "worktree": null,
      "intendedState": "paused"
    }
  ]
}
EOF
rm -f "$STATE_FILE.tmp"
echo "   ✅ state.json created with path: $REPO_ROOT"

# Create _tasks directory if it doesn't exist
if [ ! -d "$DATA_DIR/_tasks" ]; then
    echo "📂 Creating _tasks directory..."
    cp -r "$REPO_ROOT/_tasks-sample" "$DATA_DIR/_tasks"
    echo "   ✅ _tasks created with sample data"
fi

# Create _schedules directory if it doesn't exist
if [ ! -d "$DATA_DIR/_schedules" ]; then
    echo "📅 Creating _schedules directory..."
    cp -r "$REPO_ROOT/_schedules-sample" "$DATA_DIR/_schedules"
    echo "   ✅ _schedules created with sample data"
fi

# Create _inbox directory if it doesn't exist
if [ ! -d "$DATA_DIR/_inbox" ]; then
    echo "📥 Creating _inbox directory..."
    cp -r "$REPO_ROOT/_inbox-sample" "$DATA_DIR/_inbox"
    echo "   ✅ _inbox created with sample data"
fi

# Create config.yml in data dir if missing
if [ ! -f "$DATA_DIR/config.yml" ]; then
    echo "⚙️  Creating config.yml..."
    if [ -f "$REPO_ROOT/config.yml" ]; then
        cp "$REPO_ROOT/config.yml" "$DATA_DIR/config.yml"
    elif [ -f "$REPO_ROOT/config.sample.yml" ]; then
        cp "$REPO_ROOT/config.sample.yml" "$DATA_DIR/config.yml"
    else
        cat > "$DATA_DIR/config.yml" <<'EOF'
projects_root: ${PROJECTS_ROOT:-/path/to/projects}
projects: []
plugins:
  enabled:
    - bb-inbox
  disabled: []
EOF
    fi
    echo "   ✅ config.yml created"
fi

# Create empty _codex if it doesn't exist (use sample as fallback)
if [ ! -d "$DATA_DIR/_codex" ]; then
    echo "📚 Using _codex-sample as knowledge base..."
    echo "   (You can create your own _codex later)"
fi

# Setup .claude/hooks/ and settings.json for SessionStart Hook
echo "🪝 Setting up SessionStart Hook..."
mkdir -p "$REPO_ROOT/.claude/hooks"

if [ ! -f "$REPO_ROOT/.claude/hooks/session-start-copy-plugins.sh" ]; then
    if [ -f "$REPO_ROOT/.claude/hooks/session-start-copy-plugins.sh.sample" ]; then
        cp "$REPO_ROOT/.claude/hooks/session-start-copy-plugins.sh.sample" "$REPO_ROOT/.claude/hooks/session-start-copy-plugins.sh"
        chmod +x "$REPO_ROOT/.claude/hooks/session-start-copy-plugins.sh"
        echo "   ✅ SessionStart Hook script created"
    fi
fi

if [ ! -f "$REPO_ROOT/.claude/settings.json" ]; then
    if [ -f "$REPO_ROOT/.claude/settings.json.sample" ]; then
        cp "$REPO_ROOT/.claude/settings.json.sample" "$REPO_ROOT/.claude/settings.json"
        echo "   ✅ .claude/settings.json created"
    fi
fi

# Setup global Claude Code settings
GLOBAL_CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [ -f "$GLOBAL_CLAUDE_SETTINGS" ]; then
    # Check if SessionStart hook is already configured
    if ! grep -q "session-start-copy-plugins.sh" "$GLOBAL_CLAUDE_SETTINGS" 2>/dev/null; then
        echo "   📝 Adding SessionStart Hook to global Claude Code settings..."
        echo "   ⚠️  Manual step required:"
        echo "      Add the following to $GLOBAL_CLAUDE_SETTINGS under \"hooks\" section:"
        echo ""
        echo "      \"SessionStart\": ["
        echo "        {"
        echo "          \"hooks\": ["
        echo "            {"
        echo "              \"type\": \"command\","
        echo "              \"command\": \"$REPO_ROOT/.claude/hooks/session-start-copy-plugins.sh\""
        echo "            }"
        echo "          ]"
        echo "        }"
        echo "      ]"
        echo ""
    else
        echo "   ✅ SessionStart Hook already configured in global settings"
    fi
else
    echo "   ⚠️  $GLOBAL_CLAUDE_SETTINGS not found"
    echo "      SessionStart Hook will not work automatically for new sessions"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the server: npm start"
echo "2. Open http://localhost:31013 in your browser"
echo "3. Explore the sample tasks and sessions"
echo ""
echo "🥋 Jujutsu (AI-first VCS):"
if command -v jj &> /dev/null; then
    echo "   ✅ Ready! Use 'jj status' to see your workspace"
else
    echo "   Install: brew install jj"
    echo "   Initialize: jj git init"
fi
echo ""
echo "Optional: Set BRAINBASE_ROOT to use a different workspace"
echo "  export BRAINBASE_ROOT=/path/to/your/workspace"
echo "Optional: Set BRAINBASE_VAR_DIR to store runtime files elsewhere"
echo "  export BRAINBASE_VAR_DIR=/path/to/your/var"
echo ""
echo "Optional: Enable auto handover (/handover) for Codex sessions"
echo "  export BRAINBASE_AUTO_HANDOVER=1"
echo "  export BRAINBASE_AUTO_HANDOVER_DELAY_SEC=90  # default: 90"
echo ""
