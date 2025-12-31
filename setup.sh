#!/bin/bash
# Brainbase Initial Setup Script
# This script sets up the necessary files for first-time users

set -e

echo "🧠 Brainbase Initial Setup"
echo "=========================="
echo ""

# Check if already initialized
if [ -f "state.json" ]; then
    echo "⚠️  state.json already exists. Skipping initialization."
    echo "   If you want to reset, run: rm state.json && ./setup.sh"
    exit 0
fi

# Create state.json from sample
echo "📝 Creating state.json from state.sample.json..."
cp state.sample.json state.json
echo "   ✅ state.json created"

# Create _tasks directory if it doesn't exist
if [ ! -d "_tasks" ]; then
    echo "📂 Creating _tasks directory..."
    cp -r _tasks-sample _tasks
    echo "   ✅ _tasks created with sample data"
fi

# Create _schedules directory if it doesn't exist
if [ ! -d "_schedules" ]; then
    echo "📅 Creating _schedules directory..."
    cp -r _schedules-sample _schedules
    echo "   ✅ _schedules created with sample data"
fi

# Create _inbox directory if it doesn't exist
if [ ! -d "_inbox" ]; then
    echo "📥 Creating _inbox directory..."
    cp -r _inbox-sample _inbox
    echo "   ✅ _inbox created with sample data"
fi

# Create empty _codex if it doesn't exist (use sample as fallback)
if [ ! -d "_codex" ]; then
    echo "📚 Using _codex-sample as knowledge base..."
    echo "   (You can create your own _codex later)"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the server: npm start"
echo "2. Open http://localhost:3000 in your browser"
echo "3. Explore the sample tasks and sessions"
echo ""
echo "Optional: Set BRAINBASE_ROOT to use a different workspace"
echo "  export BRAINBASE_ROOT=/path/to/your/workspace"
echo ""
