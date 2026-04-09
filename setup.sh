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
  esac
done

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
    echo "ANTHROPIC_API_KEY=$api_key" > .env
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
echo ""
info "Installing dependencies..."

info "  Root..."
npm install --silent 2>&1 | tail -1 || npm install
ok "  Root deps installed"

info "  Server..."
(cd server && npm install --silent 2>&1 | tail -1 || npm install)
ok "  Server deps installed"

info "  Client..."
(cd client && npm install --silent 2>&1 | tail -1 || npm install)
ok "  Client deps installed"

# ── 5. Create projects dir ───────────────────────────────────────
PROJECTS="${PROJECTS_ROOT:-./projects}"
mkdir -p "$PROJECTS"
ok "Projects directory: $PROJECTS"

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
    if ! command -v pm2 &>/dev/null && ! npx pm2 --version &>/dev/null 2>&1; then
      warn "pm2 not found globally. Installing via npx..."
    fi

    echo -e "  ${BOLD}${GREEN}Starting production server via PM2...${NC}"
    echo -e "  ─────────────────────────────"
    echo -e "  ${BOLD}Server:${NC}  http://localhost:${PORT}"
    echo -e "  ${BOLD}Mode:${NC}    production (PM2 daemon)"
    echo ""

    npx pm2 start ecosystem.config.cjs
    ok "Server started as PM2 daemon"
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
