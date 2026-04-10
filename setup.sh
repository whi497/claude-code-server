#!/usr/bin/env bash
#
# claude-code-server — one-click setup & launch
#
# Usage:
#   ./setup.sh              # install + start dev mode
#   ./setup.sh --prod       # install + build client + start production (PM2 daemon)
#   ./setup.sh --prod --fg  # install + build client + start production (foreground)
#   ./setup.sh --install    # install only (no start)
#
# Environment:
#   ANTHROPIC_API_KEY       # required — set before running or add to .env
#   ANTHROPIC_BASE_URL      # API base URL (default: https://api.anthropic.com)
#   PORT                    # server port (default: 3001)
#   PROJECTS_ROOT           # workspace root (default: ./projects)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ───────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ── Parse args ───────────────────────────────────────────────────
MODE="dev"
INSTALL_ONLY=false
FOREGROUND=false
for arg in "$@"; do
  case "$arg" in
    --prod|--production) MODE="prod" ;;
    --fg|--foreground)   FOREGROUND=true ;;
    --install)           INSTALL_ONLY=true ;;
    --help|-h)
      echo "Usage: ./setup.sh [--prod [--fg]] [--install] [--help]"
      echo ""
      echo "  (default)    Install dependencies + start dev mode (HMR)"
      echo "  --prod       Install + build client + start production via PM2 (daemon)"
      echo "  --prod --fg  Install + build client + start production foreground (no PM2)"
      echo "  --install    Install dependencies only, don't start"
      echo ""
      echo "Environment variables:"
      echo "  ANTHROPIC_API_KEY   (required) Your Anthropic API key"
      echo "  ANTHROPIC_BASE_URL  API base URL (default: https://api.anthropic.com)"
      echo "  PORT                Server port (default: 3001)"
      echo "  PROJECTS_ROOT       Workspace root (default: ./projects)"
      exit 0
      ;;
    *)
      fail "Unknown option: $arg (see ./setup.sh --help)"
      ;;
  esac
done

# Validate flag combinations
if $FOREGROUND && [ "$MODE" != "prod" ]; then
  fail "--fg/--foreground requires --prod"
fi

echo ""
echo -e "${BOLD}${CYAN}  Claude Code Server — Setup${NC}"
echo -e "  ─────────────────────────────"
echo ""

# ── 1. Check prerequisites ───────────────────────────────────────
info "Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it: https://nodejs.org (v18+)"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  fail "Node.js v18+ required (found v$(node -v))"
fi
ok "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm not found"
fi
ok "npm $(npm -v)"

# ── 2. Load .env if present ──────────────────────────────────────
if [ -f .env ]; then
  info "Loading .env file..."
  set -a
  source .env
  set +a
  ok ".env loaded"
fi

# ── 3. Check ANTHROPIC_API_KEY ───────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  warn "ANTHROPIC_API_KEY is not set!"
  echo ""
  echo -e "  Set it in one of these ways:"
  echo -e "    ${BOLD}export ANTHROPIC_API_KEY=sk-ant-...${NC}"
  echo -e "    ${BOLD}echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env${NC}"
  echo ""
  read -rp "  Enter your API key now (or Ctrl+C to abort): " api_key
  if [ -z "$api_key" ]; then
    fail "API key is required"
  fi
  export ANTHROPIC_API_KEY="$api_key"
  # Optionally save to .env
  read -rp "  Save to .env for next time? [Y/n]: " save_env
  if [[ ! "$save_env" =~ ^[Nn] ]]; then
    if [ -f .env ] && grep -q '^ANTHROPIC_API_KEY=' .env; then
      sed -i 's|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY='"$api_key"'|' .env
    else
      echo "ANTHROPIC_API_KEY=$api_key" >> .env
    fi
    ok "Saved to .env"
  fi
fi
ok "ANTHROPIC_API_KEY is set"

# ── 3b. Check ANTHROPIC_BASE_URL ────────────────────────────────
if [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
  info "ANTHROPIC_BASE_URL not set (will use default: https://api.anthropic.com)"
else
  ok "ANTHROPIC_BASE_URL = ${ANTHROPIC_BASE_URL}"
fi

# ── 4. Install dependencies ──────────────────────────────────────
# Install deps only if package.json or package-lock.json changed since last install.
# Usage: smart_install <label> [dir]
smart_install() {
  local label="$1"
  local dir="${2:-.}"

  info "  ${label}..."

  local pkg="$dir/package.json"
  local lock="$dir/package-lock.json"
  local stamp="$dir/node_modules/.install-stamp"

  # Skip if stamp exists and is newer than package.json and package-lock.json
  if [ -f "$stamp" ] \
     && [ "$stamp" -nt "$pkg" ] \
     && { [ ! -f "$lock" ] || [ "$stamp" -nt "$lock" ]; }; then
    ok "  ${label} deps up-to-date (skipped)"
    return 0
  fi

  if (cd "$dir" && npm install --no-audit --no-fund); then
    # Sleep briefly to ensure stamp is strictly newer than any files npm touched
    sleep 0.1
    touch "$dir/node_modules/.install-stamp"
    ok "  ${label} deps installed"
  else
    fail "  ${label}: npm install failed (see errors above)"
  fi
}

echo ""
info "Installing dependencies..."

smart_install "Root" "."
smart_install "Server" "server"
smart_install "Client" "client"

# ── 5. Create required directories ───────────────────────────────
PROJECTS="${PROJECTS_ROOT:-./projects}"
mkdir -p "$PROJECTS"
ok "Projects directory: $PROJECTS"
mkdir -p logs
ok "Logs directory: logs/"

# ── 6. Early exit if install-only ────────────────────────────────
if $INSTALL_ONLY; then
  echo ""
  ok "Installation complete! Run ${BOLD}./setup.sh${NC} to start."
  exit 0
fi

# ── 7. Start ─────────────────────────────────────────────────────
echo ""
PORT="${PORT:-3001}"

if [ "$MODE" = "prod" ]; then
  # Production: build client, serve static + API from Express
  info "Building client for production..."
  rm -rf client/dist
  (cd client && npx vite build)
  ok "Client built → client/dist/"

  echo ""

  if $FOREGROUND; then
    # Foreground mode: run tsx directly (blocks terminal, no daemon)
    echo -e "  ${BOLD}${GREEN}Starting production server (foreground)...${NC}"
    echo -e "  ─────────────────────────────"
    echo -e "  ${BOLD}Server:${NC}  http://localhost:${PORT}"
    echo -e "  ${BOLD}Mode:${NC}    production (foreground, Ctrl+C to stop)"
    echo ""

    cd server && exec npx tsx src/index.ts
  else
    # PM2 daemon mode (default): auto-restart, log rotation, survives terminal close
    if ! command -v pm2 &>/dev/null; then
      info "pm2 not found globally, will use npx..."
    fi

    echo -e "  ${BOLD}${GREEN}Starting production server via PM2...${NC}"
    echo -e "  ─────────────────────────────"
    echo -e "  ${BOLD}Server:${NC}  http://localhost:${PORT}"
    echo -e "  ${BOLD}Mode:${NC}    production (PM2 daemon)"
    echo ""

    # Clean up any existing process to ensure a fresh start
    pm2 delete claude-code-server 2>/dev/null || true

    pm2 start ecosystem.config.cjs

    # Verify the process actually started (not just pm2 registering it)
    sleep 3
    PM2_PID=$(pm2 pid claude-code-server 2>/dev/null || echo "")
    if [ -n "$PM2_PID" ] && [ "$PM2_PID" != "0" ]; then
      ok "Server started as PM2 daemon (PID: ${PM2_PID})"
    else
      echo ""
      warn "PM2 process may have crashed on startup. Recent logs:"
      pm2 logs claude-code-server --lines 20 --nostream 2>/dev/null || true
      echo ""
      fail "Server failed to start. Check the logs above or run: npm run logs"
    fi

    echo ""
    echo -e "  Useful commands:"
    echo -e "    ${BOLD}npm run logs${NC}     View live logs"
    echo -e "    ${BOLD}npm run status${NC}   Check process status"
    echo -e "    ${BOLD}npm stop${NC}         Stop the server"
    echo -e "    ${BOLD}npm restart${NC}      Rebuild client + restart"
  fi

else
  # Dev: concurrent server + vite HMR
  echo -e "  ${BOLD}${GREEN}Starting development server...${NC}"
  echo -e "  ─────────────────────────────"
  echo -e "  ${BOLD}Client:${NC}  http://localhost:5173  ${CYAN}(open this)${NC}"
  echo -e "  ${BOLD}Server:${NC}  http://localhost:${PORT}"
  echo -e "  ${BOLD}Mode:${NC}    development (HMR)"
  echo ""

  exec npm run dev
fi
