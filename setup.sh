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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"
ENV_EXAMPLE="$BACKEND_DIR/.env.example"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
GITHUB_TOKENS_URL="https://github.com/settings/tokens"

open_url() {
  if command -v open &>/dev/null; then
    open "$1"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$1"
  else
    info "Open this URL in your browser:"
    echo -e "     ${BOLD}$1${RESET}"
  fi
}

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}🔭 RepoLens${RESET}  ${DIM}first-time setup${RESET}"
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"

# ── 1. Ensure .env exists ─────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok "Created ${DIM}.env${RESET} from ${DIM}.env.example${RESET}"
  else
    cat > "$ENV_FILE" <<'ENVEOF'
CLAUDE_PROVIDER=cli
PORT=3847
GITHUB_API_BASE=https://api.github.com
GITHUB_HOST=github.com
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_MAX_TOKENS_INSTANT=2048
CLAUDE_MAX_TOKENS_ENHANCED=4096
ENVEOF
    ok "Created ${DIM}.env${RESET} with defaults"
  fi
else
  ok ".env file exists"
fi

# ── 2. GitHub Token ───────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}GitHub Token${RESET}"
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"

current_token=$(grep -E '^GITHUB_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || true)

if [ -n "$current_token" ] && [ "$current_token" != "ghp_..." ]; then
  # Validate the token with a quick API call
  status_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token $current_token" \
    "https://api.github.com/user" 2>/dev/null || echo "000")

  if [ "$status_code" = "200" ]; then
    ok "GitHub token is valid"
  else
    warn "GitHub token exists but returned HTTP ${status_code}"
    echo ""
    echo -e "  ${YELLOW}?${RESET}  Would you like to update it?"
    echo -e "     ${BOLD}1${RESET})  Yes, I have a new token"
    echo -e "     ${BOLD}2${RESET})  Yes, I need to create one"
    echo -e "     ${BOLD}3${RESET})  No, keep the current token"
    echo ""
    read -r -p "     Choose [1/2/3]: " choice
    case "$choice" in
      1)
        echo ""
        read -r -p "     Paste your GitHub token: " new_token
        if [ -n "$new_token" ]; then
          if grep -q '^GITHUB_TOKEN=' "$ENV_FILE"; then
            sed -i.bak "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=${new_token}|" "$ENV_FILE"
            rm -f "$ENV_FILE.bak"
          else
            echo "GITHUB_TOKEN=${new_token}" >> "$ENV_FILE"
          fi
          ok "GitHub token updated"
        else
          warn "No token entered — skipped"
        fi
        ;;
      2)
        echo ""
        info "Opening GitHub token page…"
        open_url "$GITHUB_TOKENS_URL"
        echo ""
        echo -e "     ${DIM}Create a ${BOLD}Classic${RESET}${DIM} token with ${BOLD}repo${RESET}${DIM} scope${RESET}"
        echo ""
        read -r -p "     Paste your new token: " new_token
        if [ -n "$new_token" ]; then
          if grep -q '^GITHUB_TOKEN=' "$ENV_FILE"; then
            sed -i.bak "s|^GITHUB_TOKEN=.*|GITHUB_TOKEN=${new_token}|" "$ENV_FILE"
            rm -f "$ENV_FILE.bak"
          else
            echo "GITHUB_TOKEN=${new_token}" >> "$ENV_FILE"
          fi
          ok "GitHub token saved"
        else
          warn "No token entered — skipped"
        fi
        ;;
      *)
        info "Keeping current token"
        ;;
    esac
  fi
else
  warn "No GitHub token configured"
  echo ""
  echo -e "  ${YELLOW}?${RESET}  Do you have a GitHub Personal Access Token?"
  echo -e "     ${BOLD}1${RESET})  Yes, I have a token"
  echo -e "     ${BOLD}2${RESET})  No, I need to create one"
  echo ""
  read -r -p "     Choose [1/2]: " choice
  case "$choice" in
    1)
      echo ""
      read -r -p "     Paste your GitHub token: " new_token
      if [ -n "$new_token" ]; then
        if grep -q '^GITHUB_TOKEN=' "$ENV_FILE" || grep -q '^# *GITHUB_TOKEN=' "$ENV_FILE"; then
          sed -i.bak "s|^#* *GITHUB_TOKEN=.*|GITHUB_TOKEN=${new_token}|" "$ENV_FILE"
          rm -f "$ENV_FILE.bak"
        else
          echo "GITHUB_TOKEN=${new_token}" >> "$ENV_FILE"
        fi
        ok "GitHub token saved"
      else
        warn "No token entered — skipped"
      fi
      ;;
    2|*)
      echo ""
      info "Opening GitHub token page…"
      open_url "$GITHUB_TOKENS_URL"
      echo ""
      echo -e "     ${DIM}Steps:${RESET}"
      echo -e "     ${DIM}1. Click ${BOLD}Generate new token${RESET}${DIM} → ${BOLD}Classic${RESET}"
      echo -e "     ${DIM}2. Give it a name ${DIM}(e.g. RepoLens)${RESET}"
      echo -e "     ${DIM}3. Select the ${BOLD}repo${RESET}${DIM} scope${RESET}"
      echo -e "     ${DIM}4. Click ${BOLD}Generate token${RESET}${DIM} and copy it${RESET}"
      echo ""
      read -r -p "     Paste your new token: " new_token
      if [ -n "$new_token" ]; then
        if grep -q '^GITHUB_TOKEN=' "$ENV_FILE" || grep -q '^# *GITHUB_TOKEN=' "$ENV_FILE"; then
          sed -i.bak "s|^#* *GITHUB_TOKEN=.*|GITHUB_TOKEN=${new_token}|" "$ENV_FILE"
          rm -f "$ENV_FILE.bak"
        else
          echo "GITHUB_TOKEN=${new_token}" >> "$ENV_FILE"
        fi
        ok "GitHub token saved"
      else
        warn "No token entered — skipped"
      fi
      ;;
  esac
fi

# ── 3. Claude CLI ─────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Claude CLI${RESET}"
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"

if ! command -v "$CLAUDE_BIN" &>/dev/null; then
  fail "Claude CLI ${DIM}('$CLAUDE_BIN')${RESET} not found on PATH"
  echo ""
  echo -e "     ${DIM}Install it:  ${BOLD}npm install -g @anthropic-ai/claude-code${RESET}"
  echo -e "     ${DIM}Or set:      ${BOLD}export CLAUDE_BIN=/path/to/claude${RESET}"
  echo ""
else
  ok "Claude CLI found ${DIM}($(command -v "$CLAUDE_BIN"))${RESET}"

  auth_json=$("$CLAUDE_BIN" auth status 2>&1) || true
  logged_in=$(echo "$auth_json" | grep -o '"loggedIn":\s*true' || true)

  if [ -z "$logged_in" ]; then
    warn "Claude CLI not authenticated"
    info "Running ${BOLD}claude auth login${RESET}…"
    echo ""
    "$CLAUDE_BIN" auth login
    echo ""
    ok "Claude CLI authenticated"
  else
    email=$(echo "$auth_json" | grep -o '"email":"[^"]*"' | cut -d'"' -f4 || true)
    ok "Claude CLI authenticated ${DIM}(${email:-ok})${RESET}"
  fi
fi

# ── 4. Dependencies ───────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Dependencies${RESET}"
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"

info "Installing npm packages…"
npm install --prefix "$BACKEND_DIR" --silent 2>/dev/null
ok "Dependencies ready"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}─────────────────────────────────────────${RESET}"
echo -e "  ${GREEN}${BOLD}Setup complete!${RESET}"
echo ""
echo -e "  ${DIM}Run the backend:${RESET}  ${BOLD}./start-backend.sh${RESET}"
echo ""
