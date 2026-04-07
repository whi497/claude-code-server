#!/usr/bin/env bash
#
# claude-code-server — one-click setup & launch
#
# Usage:
#   ./setup.sh              # install + start dev mode
#   ./setup.sh --prod       # install + build client + start production
#   ./setup.sh --install    # install only (no start)
#
# Environment:
#   ANTHROPIC_API_KEY       # required — set before running or add to .env
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
for arg in "$@"; do
  case "$arg" in
    --prod|--production) MODE="prod" ;;
    --install)           INSTALL_ONLY=true ;;
    --help|-h)
      echo "Usage: ./setup.sh [--prod] [--install] [--help]"
      echo ""
      echo "  (default)    Install dependencies + start dev mode (HMR)"
      echo "  --prod       Install + build client + start production server"
      echo "  --install    Install dependencies only, don't start"
      echo ""
      echo "Environment variables:"
      echo "  ANTHROPIC_API_KEY   (required) Your Anthropic API key"
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
  echo -e "  ${BOLD}${GREEN}Starting production server...${NC}"
  echo -e "  ─────────────────────────────"
  echo -e "  ${BOLD}Server:${NC}  http://localhost:${PORT}"
  echo -e "  ${BOLD}Mode:${NC}    production"
  echo ""

  # In production, serve client/dist as static files from Express
  # For now, just start the server (client is accessed via proxy or built into server)
  cd server && exec npx tsx src/index.ts

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
