#!/usr/bin/env bash
set -euo pipefail

# ── Colors & symbols ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✔${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✘${RESET}  $1"; }
info() { echo -e "  ${CYAN}→${RESET}  $1"; }

# ── Config ────────────────────────────────────────────────────────────────────
PORT="${PORT:-3847}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

REPO_REMOTE="https://github.intuit.com/mramasamy1/RepoLens.git"

echo ""
echo -e "  ${BOLD}🔭 RepoLens${RESET}  ${DIM}starting up…${RESET}"
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"

# ── Pull latest changes ──────────────────────────────────────────────────────
if git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  current_remote=$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || true)

  if [ -z "$current_remote" ]; then
    git -C "$SCRIPT_DIR" remote add origin "$REPO_REMOTE" 2>/dev/null || true
  fi

  branch=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

  if git -C "$SCRIPT_DIR" pull --rebase origin "$branch" --quiet 2>/dev/null; then
    ok "Synced latest changes ${DIM}(${branch})${RESET}"
  else
    warn "Could not pull latest changes ${DIM}— continuing with local copy${RESET}"
    git -C "$SCRIPT_DIR" rebase --abort 2>/dev/null || true
  fi
else
  warn "Not a git repo ${DIM}— skipping sync${RESET}"
fi

# ── Kill previous instance ────────────────────────────────────────────────────
pid=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$pid" ]; then
  kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  ok "Stopped previous instance ${DIM}(PID $pid)${RESET}"
fi

# ── Dependencies ──────────────────────────────────────────────────────────────
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  info "Installing dependencies…"
  npm install --prefix "$BACKEND_DIR" --silent
  ok "Dependencies installed"
else
  npm install --prefix "$BACKEND_DIR" --silent 2>/dev/null
  ok "Dependencies ready"
fi

# ── Claude CLI auth ───────────────────────────────────────────────────────────
if ! command -v "$CLAUDE_BIN" &>/dev/null; then
  warn "Claude CLI not found ${DIM}— CLI queries will fail${RESET}"
else
  auth_json=$("$CLAUDE_BIN" auth status 2>&1) || true
  logged_in=$(echo "$auth_json" | grep -o '"loggedIn":\s*true' || true)

  if [ -z "$logged_in" ]; then
    warn "Claude CLI not authenticated"
    info "Running ${BOLD}claude auth login${RESET}…"
    "$CLAUDE_BIN" auth login
    ok "Claude CLI authenticated"
  else
    ok "Claude CLI authenticated"
  fi
fi

# ── Launch ────────────────────────────────────────────────────────────────────
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"
ok "Starting server on port ${BOLD}$PORT${RESET}"
echo ""
exec node "$BACKEND_DIR/server.js"
