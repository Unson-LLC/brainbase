#!/bin/zsh
# Codex notify hook: play a short sound on completion (macOS).

if [ -x /usr/bin/afplay ]; then
  /usr/bin/afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1
elif [ -x /usr/bin/say ]; then
  /usr/bin/say "done" >/dev/null 2>&1
fi
