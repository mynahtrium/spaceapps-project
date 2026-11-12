#!/usr/bin/env bash
# Print a blank AGENT_LOG entry with a Europe/Istanbul timestamp.
# Docs/config helper only — not application code.
# Usage (from the repo root):
#   scripts/log-entry.sh >> docs/coordination/AGENT_LOG.md
# Then edit the new block: fill the fields and keep Commit as "this commit".

set -euo pipefail

ts="$(TZ=Europe/Istanbul date '+%Y-%m-%d %H:%M')"

cat <<EOF

### ${ts} Europe/Istanbul — <TASK-ID>

- Human: (first name or nickname only)
- Agent tool + model:
- Role:
- Task id:
- Files changed:
- Why:
- Commit: this commit
- Next step:
EOF
