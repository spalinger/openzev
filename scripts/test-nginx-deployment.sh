#!/usr/bin/env bash
set -euo pipefail

# Exercise the two production nginx configurations with a real stub upstream.
# The script is intentionally dependency-light: Docker supplies nginx and the
# host Python runtime supplies the upstream that records forwarded headers.

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d)
upstream_pid=""
nginx_container=""

ports=$(python3 - <<'PY'
import socket

sockets = []
for _ in range(3):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sockets.append(sock)
print(" ".join(str(sock.getsockname()[1]) for sock in sockets))
for sock in sockets:
    sock.close()
PY
)
read -r upstream_port compose_port fullstack_port <<<"$ports"

cleanup() {
    if [[ -n "$nginx_container" ]]; then
        docker rm -f "$nginx_container" >/dev/null 2>&1 || true
    fi
    if [[ -n "$upstream_pid" ]]; then
        kill "$upstream_pid" >/dev/null 2>&1 || true
        wait "$upstream_pid" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

# Pull before starting any readiness deadline (especially on a fresh CI runner).
docker pull nginx:1.31-alpine >/dev/null

header_file="$tmp_dir/headers.log"
python3 -u - "$header_file" "$upstream_port" >"$tmp_dir/upstream.log" 2>&1 <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

output_path = sys.argv[1]
listen_port = int(sys.argv[2])


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(self.headers.get("X-Forwarded-Proto", "<missing>") + "\n")
        if self.path.startswith("/api/disconnect?"):
            # Simulate an upstream failure: nginx normally logs the entire URI.
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format, *args):
        return


HTTPServer(("127.0.0.1", listen_port), Handler).serve_forever()
PY
upstream_pid=$!

for _ in {1..30}; do
    if curl --silent --output /dev/null "http://127.0.0.1:${upstream_port}/health"; then
        break
    fi
    sleep 0.1
done
curl --fail --silent --output /dev/null "http://127.0.0.1:${upstream_port}/health"

assert_forwarded_scheme() {
    local port=$1
    local expected=$2
    local header=$3
    local actual

    curl --fail --silent --show-error --max-time 5 --output /dev/null \
        -H "$header" "http://127.0.0.1:${port}/api/probe?token=query-secret"
    actual=$(tail -n 1 "$header_file")
    if [[ "$actual" != "$expected" ]]; then
        echo "expected forwarded scheme ${expected}, got ${actual}" >&2
        return 1
    fi
}

assert_logs_are_query_free() {
    local log_file=$1
    local request_lines
    request_lines=$(grep -E '"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ' "$log_file" || true)
    if ! grep -Fq 'GET /api/probe HTTP/' <<<"$request_lines"; then
        echo "missing probe access log in ${log_file}" >&2
        cat "$log_file" >&2
        return 1
    fi
    if ! grep -Eq '"GET /api/disconnect HTTP/[^"]+" 502 ' <<<"$request_lines"; then
        echo "missing failed-upstream access log in ${log_file}" >&2
        cat "$log_file" >&2
        return 1
    fi
    if grep -Eq 'query-secret|encoded-secret|referer-secret|error-secret' "$log_file" \
        || grep -Fq '?' <<<"$request_lines"; then
        echo "query string appeared in nginx access log ${log_file}" >&2
        cat "$log_file" >&2
        return 1
    fi
}

run_config() {
    local name=$1
    local source=$2
    local port=$3
    local config="$tmp_dir/${name}.conf"
    local log_file="$tmp_dir/${name}.log"

    sed \
        -e "s/listen 80;/listen ${port};/" \
        -e "s/listen 8080;/listen ${port};/" \
        -e "s#http://backend:8000#http://127.0.0.1:${upstream_port}#" \
        -e "s#http://127.0.0.1:8000#http://127.0.0.1:${upstream_port}#" \
        "$repo_root/$source" >"$config"

    : >"$header_file"
    nginx_container="${name}-$$"
    docker run -d --network host --name "$nginx_container" \
        -v "$config:/etc/nginx/conf.d/default.conf:ro" \
        nginx:1.31-alpine >/dev/null

    local ready=false
    for _ in {1..60}; do
        if curl --fail --silent --max-time 1 --output /dev/null "http://127.0.0.1:${port}/"; then
            ready=true
            break
        fi
        if [[ $(docker inspect -f '{{.State.Running}}' "$nginx_container") != true ]]; then
            break
        fi
        sleep 0.5
    done
    if [[ "$ready" != true ]]; then
        echo "nginx did not become ready for ${source}" >&2
        docker logs "$nginx_container" >&2
        return 1
    fi

    assert_forwarded_scheme "$port" https 'X-Forwarded-Proto: https'
    assert_forwarded_scheme "$port" http 'X-Forwarded-Proto: not-a-scheme'
    assert_forwarded_scheme "$port" http 'X-Forwarded-Proto:'
    curl --fail --silent --show-error --max-time 5 --output /dev/null \
        -H 'Referer: https://example.test/?token=referer-secret' \
        "http://127.0.0.1:${port}/api/probe?%73=encoded-secret"
    local failure_status
    failure_status=$(curl --silent --show-error --max-time 5 --output /dev/null \
        --write-out '%{http_code}' \
        -H 'Referer: https://example.test/?token=referer-secret' \
        "http://127.0.0.1:${port}/api/disconnect?s=error-secret")
    if [[ "$failure_status" != 502 ]]; then
        echo "expected upstream failure status 502, got ${failure_status}" >&2
        return 1
    fi

    # Finish pending requests and collect logs before checking for leaked secrets.
    docker stop "$nginx_container" >/dev/null
    docker logs "$nginx_container" >"$log_file" 2>&1
    assert_logs_are_query_free "$log_file"
    docker rm "$nginx_container" >/dev/null
    nginx_container=""
}

run_config openzev-compose-nginx frontend/nginx.compose.conf "$compose_port"
run_config openzev-fullstack-nginx docker/fullstack-nginx.conf "$fullstack_port"
