#!/usr/bin/env bash
# ============================================================
#  DMU Tool - launcher (macOS / Linux, no admin / no sudo)
# ------------------------------------------------------------
#  1. Download the Node 20 LTS ".tar.gz" / ".tar.xz" from nodejs.org.
#  2. Extract it into a folder named "node" inside this project,
#     so that "node/bin/node" sits next to this start.sh.
#     (Or set NODE_HOME below to wherever you extracted it.)
#  3. Put your key in .env:  ANTHROPIC_API_KEY=sk-ant-...
#  4. Run:  ./start.sh      (first time: chmod +x start.sh)
# ============================================================
set -e
cd "$(dirname "$0")"

# --- Where is portable Node? Default: a "node" folder beside this script ---
NODE_HOME="${NODE_HOME:-$(pwd)/node}"

if [ ! -x "$NODE_HOME/bin/node" ]; then
  echo
  echo "  [!] Could not find node at: $NODE_HOME/bin/node"
  echo
  echo "      Download Node 20 LTS (.tar.gz) from nodejs.org, extract it,"
  echo "      and rename/move the extracted folder to \"node\" inside this"
  echo "      project (or set NODE_HOME to point at it)."
  echo
  exit 1
fi

# --- Put portable Node first on PATH, for this shell only (no system change) ---
export PATH="$NODE_HOME/bin:$PATH"

# --- Make a .env if it's missing ---
if [ ! -f ".env" ]; then
  echo "  [i] No .env found - creating one from .env.example"
  cp .env.example .env
  echo "  [i] Edit .env and add your ANTHROPIC_API_KEY, then run this again."
  exit 0
fi

# --- First run: install dependencies (prebuilt SQLite, no compiler needed) ---
if [ ! -d "node_modules" ]; then
  echo "  [i] First run - installing dependencies, please wait..."
  "$NODE_HOME/bin/npm" install
fi

echo
echo "  Starting DMU Tool...  open  http://localhost:3000  in your browser."
echo "  (Press Ctrl+C to stop the server.)"
echo

# --- Open the browser shortly after boot (macOS: open / Linux: xdg-open) ---
( sleep 3; (command -v open >/dev/null && open http://localhost:3000) \
        || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) ) >/dev/null 2>&1 &

exec "$NODE_HOME/bin/node" server.js
