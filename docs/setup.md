# Setup Guide

This guide walks you through installing and configuring Claude Code Server from scratch.

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| **Node.js** | 18 or higher | `node -v` |
| **npm** | 8 or higher (ships with Node) | `npm -v` |
| **Anthropic API Key** | — | [Get one here](https://console.anthropic.com/) |

> **Note:** The `node-pty` package (used for the embedded terminal) compiles a native addon during install. On most systems this works out of the box, but you may need build tools (`python3`, `make`, `gcc`) if you see compilation errors.

---

## Installation

### Option A: One-Click Setup (Recommended)

```bash
git clone https://github.com/your-org/claude-code-server.git
cd claude-code-server
./setup.sh
```

The script handles everything:
1. Verifies Node.js 18+ is installed
2. Loads `.env` if present
3. Prompts for your API key if not set (with option to save to `.env`)
4. Installs root, server, and client dependencies
5. Creates the `projects/` directory
6. Starts the dev server

**Setup script options:**

```bash
./setup.sh              # Install + start dev mode (HMR, two ports)
./setup.sh --prod       # Install + build + start production (PM2 daemon)
./setup.sh --prod --fg  # Install + build + start production (foreground)
./setup.sh --install    # Install dependencies only (don't start)
./setup.sh --help       # Show all options
```

### Option B: Manual Installation

```bash
git clone https://github.com/your-org/claude-code-server.git
cd claude-code-server

# 1. Install dependencies
npm install                          # root (concurrently)
cd server && npm install && cd ..    # server
cd client && npm install && cd ..    # client

# 2. Configure API key
export ANTHROPIC_API_KEY=sk-ant-...
# Or save it for future sessions:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 3. Start
npm run dev
```

---

## Configuration

All configuration is done through environment variables. You can set them in your shell, or place them in a `.env` file in the project root.

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key. Required to run Claude. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Custom API base URL. Use this if you're connecting through a proxy, API gateway, or a compatible endpoint. |
| `PORT` | `3001` | The port the server listens on. In dev mode, the Vite client dev server runs on port 5173 and proxies API calls to this port. In production, everything is served from this single port. |
| `PROJECTS_ROOT` | `./projects` | Where project working directories are created. Can be an absolute path. |

### Example `.env` file

```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://api.anthropic.com
PORT=3001
PROJECTS_ROOT=./projects
```

---

## Starting the Server

### Development Mode

```bash
npm run dev
```

This starts two processes concurrently:
- **Server** on `http://localhost:3001` — Express + WebSocket backend
- **Client** on `http://localhost:5173` — Vite dev server with Hot Module Replacement

Open **http://localhost:5173** in your browser. The Vite dev server proxies all `/api` and `/ws` requests to the backend automatically.

> **Tip:** When you modify client code, changes appear instantly (HMR). Server changes require a restart (`Ctrl+C` and re-run).

### Production Mode

```bash
npm start
# or
./setup.sh --prod
```

This builds the React client into static files (`client/dist/`) and starts the Express server via PM2. The server serves both the API and the static frontend from a single port.

Open **http://localhost:3001** in your browser.

See [docs/deployment.md](deployment.md) for production deployment details.

---

## Verifying the Installation

1. Open the web UI in your browser
2. You should see the landing page with "Claude Code Server" and two buttons
3. Click **Create Project** — enter a name (e.g., "test")
4. Click **New Job** — type a prompt like `"What files are in this directory?"`
5. Watch Claude's response stream in real-time

If you see a connection indicator (green dot in the sidebar), the WebSocket is connected and everything is working.

---

## Updating

```bash
cd claude-code-server
git pull

# Re-install dependencies (in case package.json changed)
cd server && npm install && cd ..
cd client && npm install && cd ..

# Restart
npm restart    # production (PM2)
# or
npm run dev    # development
```

---

## Troubleshooting

### "ANTHROPIC_API_KEY is not set"

Set your API key before starting:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or create a .env file:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

### `node-pty` installation fails

The `node-pty` package requires native compilation. Install build tools:

```bash
# Ubuntu/Debian
sudo apt-get install -y build-essential python3

# macOS (Xcode command line tools)
xcode-select --install

# Then retry
cd server && npm install
```

### Port already in use

Change the port:
```bash
PORT=4000 npm run dev
```

### WebSocket not connecting

- In dev mode, make sure you're opening `http://localhost:5173` (the Vite port), not `http://localhost:3001`
- In production, open `http://localhost:3001` (or your configured `PORT`)
- Check that no firewall is blocking WebSocket connections

### Server crashes on startup

Check the logs:
```bash
npm run logs    # PM2 logs (production)
```

Common causes:
- Invalid API key
- Missing dependencies (re-run `npm install` in server/ and client/)
- Port conflict

---

## Data Storage

Claude Code Server stores all runtime data in the `PROJECTS_ROOT` directory (default: `./projects/`).

| Path | Description |
|------|-------------|
| `projects/.state.json` | Persisted state: all projects, jobs, and recent logs (last 200 per job) |
| `projects/<ProjectName>/` | Per-project working directory (where Claude reads/writes files) |

**State persistence notes:**
- State is saved after every mutation (job created, status changed, log appended, etc.)
- Writes are atomic (write to `.tmp`, then rename)
- On server restart, jobs that were `running` or `idle` are marked as `failed`
- Sessions can be resumed after restart if the job has a `sessionId`
- Image attachment data (base64) is not persisted to save space — only metadata is kept

---

## Next Steps

- **[Usage Guide](usage.md)** — Learn how to use every feature
- **[Deployment Guide](deployment.md)** — Set up for production
- **[API Reference](api.md)** — REST and WebSocket API docs
