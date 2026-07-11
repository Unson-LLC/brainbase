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

# Check Git repository setup (required for AI-first session management)
echo "🔧 Checking Git..."
if command -v git &> /dev/null; then
    echo "   ✅ Git is installed: $(git --version 2>&1 | head -1)"

    if [ -d "$REPO_ROOT/.git" ]; then
        echo "   ✅ Git repository already initialized"

        GIT_USER_NAME=$(git config user.name 2>/dev/null)
        GIT_USER_EMAIL=$(git config user.email 2>/dev/null)
        if [ -n "$GIT_USER_NAME" ] && [ -n "$GIT_USER_EMAIL" ]; then
            echo "   ✅ Git user configured: $GIT_USER_NAME <$GIT_USER_EMAIL>"
        else
            echo "   ⚠️  Git user is not configured. Set it with:"
            echo "      git config user.name \"Your Name\""
            echo "      git config user.email \"you@example.com\""
        fi
    else
        echo "   ⚠️  This directory is not a Git repository (.git not found)"
        echo "      Run: git init"
    fi
else
    echo "   ❌ Git is not installed. Please install Git before continuing."
fi
echo ""

# Create .env from .env.example if it doesn't exist
if [ ! -f "$REPO_ROOT/.env" ]; then
    echo "📝 Creating .env from .env.example..."
    if [ -f "$REPO_ROOT/.env.example" ]; then
        cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
        echo "   ✅ .env created"
        echo "   ⚠️  Edit .env with your credentials for authentication (optional)"
    else
        echo "   ⚠️  .env.example not found, skipping .env creation"
    fi
else
    echo "📝 .env already exists, skipping"
fi
echo ""

# Ensure local data/runtime dirs exist
mkdir -p "$DATA_DIR" "$VAR_DIR"

# Create state.json from sample
echo "📝 Creating state.json from config/state.sample.json..."
# Replace placeholder paths with actual repository path
sed "s|/path/to/brainbase|$REPO_ROOT|g" "$REPO_ROOT/config/state.sample.json" > "$STATE_FILE.tmp"

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
    cp -r "$REPO_ROOT/examples/tasks" "$DATA_DIR/_tasks"
    echo "   ✅ _tasks created with sample data"
fi

# Create _schedules directory if it doesn't exist
if [ ! -d "$DATA_DIR/_schedules" ]; then
    echo "📅 Creating _schedules directory..."
    cp -r "$REPO_ROOT/examples/schedules" "$DATA_DIR/_schedules"
    echo "   ✅ _schedules created with sample data"
fi

# Create _inbox directory if it doesn't exist
if [ ! -d "$DATA_DIR/_inbox" ]; then
    echo "📥 Creating _inbox directory..."
    cp -r "$REPO_ROOT/examples/inbox" "$DATA_DIR/_inbox"
    echo "   ✅ _inbox created with sample data"
fi

# Create config.yml in data dir if missing
if [ ! -f "$DATA_DIR/config.yml" ]; then
    echo "⚙️  Creating config.yml..."
    if [ -f "$REPO_ROOT/config.yml" ]; then
        cp "$REPO_ROOT/config.yml" "$DATA_DIR/config.yml"
    elif [ -f "$REPO_ROOT/config/config.sample.yml" ]; then
        cp "$REPO_ROOT/config/config.sample.yml" "$DATA_DIR/config.yml"
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
echo "🔧 Git (AI-first VCS):"
if command -v git &> /dev/null; then
    echo "   ✅ Ready! Use 'git status' to see your workspace"
else
    echo "   Install Git for your platform, then run: git init"
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
