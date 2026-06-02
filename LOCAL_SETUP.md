# Running DMU Tool locally (no admin rights needed)

This runs entirely on `localhost` using a **portable** copy of Node — just
extracted files in your own user folder. No installer, no admin prompt, no
registry changes, no system PATH changes, and no C++ compiler. Deleting the
folder removes everything.

## One-time setup

1. **Get portable Node (not the installer):**
   - Go to <https://nodejs.org> → **Downloads** → choose Node **20 LTS**.
   - Windows: pick **Windows Binary (.zip)** — *not* the `.msi`.
   - macOS/Linux: pick the **.tar.gz / .tar.xz**.

2. **Extract it into this project** as a folder named `node`, so you have:
   - Windows: `node\node.exe` next to `start.bat`
   - macOS/Linux: `node/bin/node` next to `start.sh`

   (Prefer keeping Node elsewhere? Set the `NODE_HOME` variable at the top of
   the start script to point at your extracted folder instead.)

3. **Add your Claude key** to the `.env` file in this folder:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   (`.env` is git-ignored, so your key never gets committed.)

## Running it

- **Windows:** double-click `start.bat`
- **macOS/Linux:** `chmod +x start.sh` once, then `./start.sh`

The first run installs dependencies (this downloads a **prebuilt** SQLite
binary — no compiler required). After that it boots in a couple of seconds,
opens <http://localhost:3000> in your browser, and you're in. Close the
window (or Ctrl+C) to stop the server.

## Why IT has nothing to flag
- **No installation** — portable files in your user space only.
- **No admin / UAC** — never touches Program Files or the registry.
- **Localhost only** — binds to `127.0.0.1:3000`; nothing is exposed to the
  network and no inbound ports are opened.
- **Outbound only** — talks to the same APIs a browser would (Anthropic for
  Claude, plus the parliamentary/news data feeds).

## Notes
- The SQLite database lives in `db/dmu.sqlite` (git-ignored). It's created
  automatically on first boot and persists between runs.
- To turn off the scheduled background jobs, set `DISABLE_CRON=1` in `.env`.
- If your laptop blocks running downloaded executables entirely, the
  fallback is to host the app on a cloud box and just use the laptop's
  browser to reach it — see the Railway notes.
