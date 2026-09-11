#!/usr/bin/env bash
# Starts and stops the local services the agentic example needs: a public tunnel to the Next.js
# dev server, the dev server itself, and the Anthropic environment/agent that point at it.
# Driven by the Makefile — run `make help` rather than calling this directly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3000}"
RUN_DIR="$ROOT/.run"
ENV_FILE="$ROOT/.env"
TUNNEL_LOG="$RUN_DIR/tunnel.log"
NEXT_LOG="$RUN_DIR/next.log"
TUNNEL_PIDFILE="$RUN_DIR/tunnel.pid"
NEXT_PIDFILE="$RUN_DIR/next.pid"
QUICK_TUNNEL_CMD="cloudflared tunnel --url http://localhost:$PORT"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m xx\033[0m %s\n' "$*" >&2; exit 1; }

# --- .env helpers -------------------------------------------------------------------------------
# Read and write single keys without sourcing the file, so values with spaces or shell
# metacharacters cannot be executed.

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed 's/^"//; s/"$//'
}

env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'index($0, k "=") == 1 { print k "=" v; next } { print }' "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

# --- process helpers ----------------------------------------------------------------------------

is_running() {
  local pidfile="$1" pid
  [ -f "$pidfile" ] || return 1
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_pidfile() {
  local pidfile="$1" label="$2" pid
  if ! is_running "$pidfile"; then
    rm -f "$pidfile"
    return 0
  fi
  pid="$(cat "$pidfile")"
  log "Stopping $label (pid $pid)"
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pidfile"
}

# Waits for a URL to answer with anything other than "not listening yet" or a tunnel 502/503.
wait_http() {
  local url="$1" label="$2" tries="${3:-60}" code
  for _ in $(seq 1 "$tries"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)"
    case "$code" in
      "" | 000 | 502 | 503 | 504) ;;
      *)
        log "$label ready (HTTP $code)"
        return 0
        ;;
    esac
    sleep 2
  done
  warn "$label did not come up in time; check $RUN_DIR"
  return 1
}

# --- preflight ----------------------------------------------------------------------------------

preflight() {
  [ -f "$ENV_FILE" ] || {
    cp "$ROOT/.env.example" "$ENV_FILE"
    die "No .env found. I copied .env.example to .env — fill it in, then run 'make up' again."
  }

  local missing=()
  for key in AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    [ -n "$(env_get "$key")" ] || missing+=("$key")
  done
  [ ${#missing[@]} -eq 0 ] || die "These .env values are empty: ${missing[*]}"

  command -v cloudflared >/dev/null 2>&1 || die "cloudflared is not installed. brew install cloudflared"

  if [ ! -d "$ROOT/node_modules" ]; then
    log "Installing dependencies"
    npm install
  fi

  log "Applying database migrations"
  npx prisma migrate deploy
}

# --- tunnel -------------------------------------------------------------------------------------

# Prints the public hostname the tunnel serves on stdout; everything else goes to stderr so the
# caller can capture it.
start_tunnel() {
  local name hostname
  name="$(env_get TUNNEL_NAME)"
  hostname="$(env_get TUNNEL_HOSTNAME)"

  if is_running "$TUNNEL_PIDFILE"; then
    log "Tunnel already running (pid $(cat "$TUNNEL_PIDFILE"))" >&2
    if [ -n "$hostname" ]; then
      printf '%s\n' "$hostname"
      return 0
    fi
    hostname="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1 | sed 's|https://||')"
    [ -n "$hostname" ] || die "Tunnel is running but no hostname was found in $TUNNEL_LOG. Run 'make down' first."
    printf '%s\n' "$hostname"
    return 0
  fi

  # A quick tunnel started outside `make up` has no pidfile, but its hostname is pinned in the
  # Console webhook and cannot be re-registered by API — so adopt it whenever it is still serving
  # the host .env points at, and only replace it when that mapping is dead.
  if pgrep -f "$QUICK_TUNNEL_CMD" >/dev/null 2>&1; then
    local known_host code
    known_host="$(env_get MCP_PUBLIC_URL | sed -n 's|^https://\([^/]*\)/api/mcp$|\1|p')"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$known_host/api/mcp" 2>/dev/null || true)"
    case "${known_host:+$code}" in
      "" | 000 | 502 | 503 | 504)
        warn "An untracked quick tunnel is running but $known_host is not answering; replacing it" >&2
        pkill -f "$QUICK_TUNNEL_CMD" || true
        sleep 1
        ;;
      *)
        log "Adopting the quick tunnel already serving $known_host" >&2
        pgrep -f "$QUICK_TUNNEL_CMD" | head -1 >"$TUNNEL_PIDFILE"
        printf '%s\n' "$known_host"
        return 0
        ;;
    esac
  fi

  if [ -n "$name" ]; then
    [ -n "$hostname" ] || die "TUNNEL_NAME is set but TUNNEL_HOSTNAME is empty; add the hostname the named tunnel routes to."
    log "Starting named tunnel '$name' on $hostname" >&2
    nohup cloudflared tunnel run "$name" >"$TUNNEL_LOG" 2>&1 &
    echo $! >"$TUNNEL_PIDFILE"
    printf '%s\n' "$hostname"
    return 0
  fi

  log "Starting a quick tunnel (its hostname changes on every restart)" >&2
  nohup $QUICK_TUNNEL_CMD >"$TUNNEL_LOG" 2>&1 &
  echo $! >"$TUNNEL_PIDFILE"

  for _ in $(seq 1 30); do
    hostname="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1 | sed 's|https://||')"
    [ -n "$hostname" ] && break
    sleep 1
  done
  [ -n "$hostname" ] || die "Timed out waiting for a quick tunnel hostname. See $TUNNEL_LOG"
  printf '%s\n' "$hostname"
}

# --- commands -----------------------------------------------------------------------------------

cmd_up() {
  mkdir -p "$RUN_DIR"
  preflight

  local hostname mcp_url webhook_url
  hostname="$(start_tunnel)"
  mcp_url="https://$hostname/api/mcp"
  webhook_url="https://$hostname/api/webhooks/anthropic"

  if [ "$(env_get MCP_PUBLIC_URL)" != "$mcp_url" ]; then
    log "Pointing MCP_PUBLIC_URL at $mcp_url"
    env_set MCP_PUBLIC_URL "$mcp_url"
  fi

  if is_running "$NEXT_PIDFILE"; then
    log "Dev server already running (pid $(cat "$NEXT_PIDFILE"))"
  elif lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
    # Started outside `make up`. Leave it alone — a second `npm run dev` would bind another port
    # and the tunnel would keep routing to this one. `make down` still frees the port.
    log "Port $PORT is already served by a dev server started elsewhere; leaving it running"
  else
    log "Starting the Next.js dev server on port $PORT"
    nohup npm run dev >"$NEXT_LOG" 2>&1 &
    echo $! >"$NEXT_PIDFILE"
  fi

  wait_http "http://localhost:$PORT/" "Dev server" || true

  # 401 here is the expected answer: the MCP route rejects a request with no bearer token. A
  # freshly minted quick tunnel can take a couple of minutes to resolve, hence the long ceiling.
  local tunnel_ok=yes
  wait_http "$mcp_url" "Tunnel → MCP route" 90 || tunnel_ok=no

  # Re-applies the environment's network policy and repoints the agent at the current hostname.
  log "Applying the Anthropic environment + agent"
  npm run setup:anthropic -- --write

  local headline
  if [ "$tunnel_ok" = yes ]; then
    headline="$(printf '\033[1;32mReady.\033[0m')"
  else
    headline="$(printf '\033[1;33mUp, but %s is not answering yet.\033[0m\n  Anthropic cannot reach the MCP server until it does — recheck with: make status' "$hostname")"
  fi

  cat <<SUMMARY

$headline
  App           http://localhost:$PORT
  MCP server    $mcp_url
  Webhook       $webhook_url
  Logs          make logs
  Test          make e2e

$(printf '\033[1;33mRegister the webhook by hand:\033[0m') there is no API for endpoint management.
In the Claude Console under Manage → Webhooks, point an endpoint at the Webhook URL above for
session.status_idled and session.status_terminated, then put its whsec_ secret in
ANTHROPIC_WEBHOOK_SIGNING_KEY. A quick tunnel gets a new hostname every restart, so set
TUNNEL_NAME and TUNNEL_HOSTNAME in .env to stop re-registering it.
SUMMARY
}

cmd_down() {
  stop_pidfile "$NEXT_PIDFILE" "dev server"
  stop_pidfile "$TUNNEL_PIDFILE" "tunnel"

  # npm spawns next as a child, so the pidfile alone can leave the port held.
  local stragglers
  stragglers="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  if [ -n "$stragglers" ]; then
    log "Freeing port $PORT"
    echo "$stragglers" | xargs kill -9 2>/dev/null || true
  fi

  pkill -f "$QUICK_TUNNEL_CMD" 2>/dev/null || true
  log "Stopped."
}

cmd_status() {
  local hostname port_pid
  port_pid="$(lsof -ti "tcp:$PORT" 2>/dev/null | head -1 || true)"
  if is_running "$NEXT_PIDFILE"; then
    log "Dev server running (pid $(cat "$NEXT_PIDFILE")) — http://localhost:$PORT"
  elif [ -n "$port_pid" ]; then
    log "Dev server running (pid $port_pid, started outside make) — http://localhost:$PORT"
  else
    warn "Dev server not running"
  fi

  if is_running "$TUNNEL_PIDFILE"; then
    hostname="$(env_get MCP_PUBLIC_URL)"
    log "Tunnel running (pid $(cat "$TUNNEL_PIDFILE")) — $hostname"
    # 401 means Anthropic can reach the MCP route; anything else means the agent cannot.
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$hostname" 2>/dev/null || true)"
    if [ "$code" = "401" ]; then
      printf '    reachable    yes (HTTP 401, no bearer token)\n'
    else
      warn "MCP route answered '${code:-no response}' — Anthropic cannot reach it"
    fi
  else
    warn "Tunnel not running"
  fi

  printf '    environment  %s\n' "$(env_get ANTHROPIC_ENVIRONMENT_ID)"
  printf '    agent        %s\n' "$(env_get VACATION_AGENT_ID)"
  printf '    webhook key  %s\n' "$([ -n "$(env_get ANTHROPIC_WEBHOOK_SIGNING_KEY)" ] && echo set || echo 'MISSING — /manage will poll instead')"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  *) die "usage: $0 {up|down|status}" ;;
esac
