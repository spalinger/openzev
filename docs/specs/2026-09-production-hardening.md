# Feature Spec: Production Hardening — Transport, Containers, Helm

- Spec ID: SPEC-2026-09-production-hardening
- Status: In Progress
- Scope: Minor
- Type: Change
- Owners: contributors
- Created: 2026-09-22
- Target Release: unreleased
- Related Issues: Helm chart maturity row in `docs/ROADMAP.md`
- Related ADRs: ADR 0021 (MFA keys independent of `SECRET_KEY` — unchanged)
- Impacted Areas: backend | docs | infra

---

## 1. Problem and outcome

Default deployments lacked explicit Django HTTPS proxy configuration, logged
query-string secrets in cleartext, ran containers as root on privileged ports, and
the Helm chart installed with placeholder secrets without complaint. After this
change, production deployments redirect HTTP to HTTPS with HSTS, log no query
secrets, run as UID 10001, and the chart fails closed on local-default secrets
and URLs while `debug: true` keeps local experiments working over plain HTTP.

## 2. Scope

### In scope

| Area | Details |
|---|---|
| Django transport | `NUM_PROXIES`-gated `SECURE_PROXY_SSL_HEADER`, `SECURE_SSL_REDIRECT`, HSTS, secure cookies (`backend/config/settings.py`) |
| Gunicorn | `--forwarded-allow-ips` from env, query-less access log without Referer (`backend/Dockerfile`, `docker/start-fullstack.sh`) |
| Nginx | Query-free access logs, scheme-preserving proxy chain, and loopback-only production Compose publication (`docker/fullstack-nginx.conf`, `frontend/nginx.conf`, `frontend/nginx.compose.conf`) |
| Containers | UID 10001, unprivileged ports (`backend/Dockerfile`, `Dockerfile.fullstack`, `frontend/Dockerfile`) |
| Helm chart | `debug` flag, fail-closed validation, security contexts, resources, and proxy/transport configuration (`charts/openzev`) |
| Docs | User-guide upgrade/terminator notes, chart README, this spec |

### Out of scope

- Enforcing or report-only CSP — deferred until a policy and reporting destination are defined.
- Kubernetes NetworkPolicy — deferred until the deployment's ingress, external database/Redis, SMTP, and egress requirements are known.
- Read-only root filesystems (WeasyPrint needs font caches; `readOnlyRootFilesystem: false` stays, documented in `values.yaml` lineage).
- WebAuthn fail-closed validation (values exist; not guarded).
- S3 smoke tests, real-object-store provisioning.

## 3. Actors, permissions, and ZEV scope

No changes. This spec alters deployment posture only; no model permissions,
endpoints, or frontend routes change.

## 4. Data model

None.

## 5. API contracts

None. No endpoint paths, serializers, or permission classes change.

## 6. Transport settings and proxy trust

### 6.1 Django (`backend/config/settings.py`)

| Setting | Env | Default | Notes |
|---|---|---|---|
| `NUM_PROXIES` | `NUM_PROXIES` | `0` | Header trusted only when `> 0`; `< 0` rejected at startup. Mirrored to `REST_FRAMEWORK["NUM_PROXIES"]` for DRF throttling / `config.client_ip` hop counting (#777) |
| `SECURE_PROXY_SSL_HEADER` | — | unset, or `("HTTP_X_FORWARDED_PROTO", "https")` when `NUM_PROXIES > 0` | A client on plain HTTP must not be able to claim HTTPS |
| `SECURE_SSL_REDIRECT` | `SECURE_SSL_REDIRECT` | `not DEBUG` | |
| `SECURE_HSTS_SECONDS` | `SECURE_HSTS_SECONDS` | `0` if `DEBUG` else `31536000` | `INCLUDE_SUBDOMAINS` false, `PRELOAD` false (hardcoded) |
| `SESSION_COOKIE_SECURE` | — | `not DEBUG` | `SameSite=Lax`; `CSRF_*` unchanged |

### 6.2 Proxy trust per deployment

| Deployment | Chain | Trust config |
|---|---|---|
| Fullstack compose | client → (same-host outer TLS terminator) → bundled nginx → gunicorn | `NUM_PROXIES=1` (`docker-compose.fullstack.yml`); the app port is published only on `127.0.0.1`. The bundled nginx accepts only an exact outer `X-Forwarded-Proto: https` and otherwise uses its own `$scheme`; the outer terminator **must** overwrite that header, or Django sees HTTP and `SECURE_SSL_REDIRECT` loops |
| Standard compose | client → (same-host outer TLS terminator) → frontend nginx → backend gunicorn | The frontend port is published only on `127.0.0.1`; `frontend/nginx.compose.conf` uses the same strict scheme map, and the backend port remains unpublished. `NUM_PROXIES=1` is set in `docker-compose.yml` |
| Helm | client → ingress → backend pod | `backend.numProxies` (default `0` = trust nothing; #777 hop-counting semantics, schema-enforced `>= 0`). `SECURE_SSL_REDIRECT`/`SECURE_HSTS_SECONDS` apply only when the scheme is trusted (non-debug render with `numProxies > 0`); otherwise both are forced off so a default install can neither redirect-loop nor HSTS-pin the wrong scheme. Set `numProxies: 1` behind a sanitising ingress for full hardening. Debug renders force redirect off and HSTS `0` |
| Dev compose / local | direct | `NUM_PROXIES=0` default; header ignored |

### 6.3 Gunicorn

Both entrypoints pass `--forwarded-allow-ips "${GUNICORN_FORWARDED_ALLOW_IPS:-127.0.0.1}"`
and log `--access-logfile -` with a format using `%(U)s` (path, never the query
string) and `%(a)s` (user-agent). The Referer field (`%(f)s`) is omitted because
it can carry query secrets.

Both also load `/app/gunicorn.conf.py`, which sets `secure_scheme_headers = {}`.
Gunicorn therefore cannot turn forwarded headers into `wsgi.url_scheme=https`
independently of Django. Django's `NUM_PROXIES`-gated
`SECURE_PROXY_SSL_HEADER` is the sole forwarded scheme trust decision, including
for loopback peers. Legacy `X-Forwarded-SSL` and `X-Forwarded-Protocol` headers
do not affect HTTPS detection or cause conflicting-scheme parsing errors.

### 6.4 Nginx

All three server configs (`docker/fullstack-nginx.conf`, `frontend/nginx.conf`,
`frontend/nginx.compose.conf`) use a server-level access log with `$uri`, not
`$request_uri`, `$request`, or `$args`. Query strings and the Referer header are
therefore omitted from proxy-side access logs, matching Gunicorn. The
server-level directive overrides nginx's inherited `http`-level access log;
the image build keeps the inherited directive intact. Server-level
`error_log /dev/null` suppresses nginx request-context errors, which otherwise
include the original query-bearing URI on upstream failures. Query-free access
logs still record the failed path and HTTP status (including 502); nginx process
diagnostics continue to stderr. Request-specific error details are deliberately
omitted because nginx cannot redact query strings in its error-log format.

The two production proxy configs also use:

```
map $http_x_forwarded_proto $forwarded_scheme {
  https    https;
  default  $scheme;
}
```

The map accepts only the canonical HTTPS signal from the loopback-bound outer
terminator. No CSP header is shipped in this change.

## 7. Containers

| Image | User | Ports | Notes |
|---|---|---|---|
| Backend (`backend/Dockerfile`) | `openzev` UID 10001, `/app` chowned | 8000 | Migrate + gunicorn via `sh -c` |
| Fullstack (`Dockerfile.fullstack`) | `openzev` UID 10001, `/app`, html, nginx runtime dirs chowned | **8080** (was 80); compose maps `127.0.0.1:8080:8080` | pid at `/tmp/nginx.pid`; Debian default site removed |
| Frontend (`frontend/Dockerfile`) | UID/GID 10001 by default (pid `/tmp/nginx.pid`; `/var/cache/nginx`, `/var/log/nginx`, html chowned) | both configs **8080**; compose maps `127.0.0.1:8080:8080` | `EXPOSE 8080`; server-level query-free access log |

## 8. Helm chart

- `debug: false` default. Non-debug renders fail via `templates/validation.yaml`:
  placeholder `secretKey.value` without `secretKey.existingSecret.name`;
  local-default `database.url` without `database.existingSecret.name`;
  `frontendUrl == http://localhost:5173`. `debug: true` skips all three (local only).
- `values.schema.json` requires boolean `debug`/`backend.secureSslRedirect`
  and non-negative integer `backend.hstsSeconds`, preventing string-valued
  booleans from bypassing validation and invalid HSTS values from being coerced.
- Workload env: backend gets `DEBUG`, `FRONTEND_URL`, `NUM_PROXIES`,
  `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` (last two take the configured
  values only with scheme trust — non-debug render and `numProxies > 0` —
  else forced to `false`/`0`); worker and beat get `DEBUG` so debug renders
  don't trip the placeholder-secret guard with production-mode settings.
  `hstsSeconds` is piped through `int`: Helm renders large integers as floats
  (`3.1536e+07`), which Django's `env.int()` rejects. `numProxies` shares
  #777's hop-counting semantics (default `0`, schema-enforced).
- Every workload: `runAsNonRoot`, `runAsUser/fsGroup 10001`, `seccompProfile
  RuntimeDefault`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`,
  `readOnlyRootFilesystem: false` (shared YAML anchors in `values.yaml`;
  `{{- with }}` guards preserve empty overrides).
- Default resources: backend 100m/256Mi → 1/1Gi; worker 100m/512Mi → 1/2Gi;
  beat and frontend 50m/128Mi → 500m/512Mi.
- NetworkPolicy is intentionally not part of this change. Operators may add
  policies appropriate to their ingress, external database/Redis, SMTP, and
  egress requirements.

## 9. Upgrade requirements

Existing Docker media volumes written by root stay root-owned;
the new images cannot write them. Stop the app/backend, worker and beat,
build the new application image, and run the one-off migration documented in
`docs/user-guide/01-getting-started.md`:

```bash
docker compose run --rm --no-deps --user root backend chown -R 10001:10001 /app/media
# Fullstack variant:
docker compose -f docker-compose.fullstack.yml run --rm --no-deps --user root app chown -R 10001:10001 /app/media
```

Helm media PVC: `fsGroup: 10001` supplies group access when supported by the
storage driver. Otherwise stop the backend/worker and run the same `chown`
via a temporary root pod mounting the claim before restarting them.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Outer proxy omits or misuses `X-Forwarded-Proto` (production Compose) | Redirect loop or scheme confusion | Production ports bind to loopback; strict nginx map; same-host terminator requirement documented |
| Root-owned media volume after upgrade | Uploads fail | One-off chown in user guide + this spec |
| No NetworkPolicy enforcement | Deployment-specific traffic may be over-permissive or over-restricted | Deferred; operators configure policies for their actual topology |

## 11. Test plan

### Backend — transport behavior and deployment guards

`config/test_settings_guards.py` keeps the isolated settings checks: the
`SECURE_PROXY_SSL_HEADER` is absent with `NUM_PROXIES=0` and equals
`("HTTP_X_FORWARDED_PROTO", "https")` with `NUM_PROXIES=1`.

`config/test_transport_behavior.py` exercises Django's actual security
middleware: plain HTTP redirects to HTTPS, a trusted forwarded HTTPS signal
does not redirect and receives HSTS, and a spoofed HTTPS header without a
trusted proxy still redirects.
It also parses actual Gunicorn requests into WSGI environments before running
Django middleware: all three Gunicorn legacy scheme headers redirect when
Django proxy trust is disabled, and trusted `X-Forwarded-Proto: https`
receives HSTS even with a conflicting legacy header.

`config/test_proxy_trust_boundary.py` pins the production Compose port
bindings, XFF overwrite, query-free nginx formats, and CORS precedence.
`scripts/test-nginx-deployment.sh` exercises scheme forwarding and query-free
logs with a stub upstream in CI. It pulls nginx before starting the container,
requires successful HTTP readiness, and checks collected logs after shutdown,
including that probe requests and upstream-failure 502 responses were actually
logged, and that neither access nor request-error output leaks query secrets.

### Infra (CI, `.github/workflows/pr-quality.yml`)

- Three independent fail-closed renders assert the secret, database, and
  frontend-URL guards separately.
- Schema checks reject string booleans for `debug`/`secureSslRedirect` and
  negative HSTS durations.
- `helm lint` in both `debug=true` and production-values modes; production
  render with existing secrets, a real `frontendUrl`, and `numProxies=1` so
  redirect/HSTS settings are present.

### Frontend

- Image builds (`frontend/Dockerfile` with both `NGINX_CONF` values); no
  TypeScript changes, so `npm run build` is unaffected.

### Acceptance criteria

- [ ] `NUM_PROXIES=0` ignores spoofed `X-Forwarded-Proto`; `=1` honors it (tests above, both orders)
- [ ] No query string or Referer query reaches nginx or Gunicorn access logs
- [ ] Production Compose is reachable only through its loopback-bound frontend; a same-host TLS terminator sending `X-Forwarded-Proto: https` serves without a redirect loop, while direct HTTP redirects
- [ ] `helm template` fails closed by default, checks each guard independently, renders with `debug=true` (all workloads debug, no redirect/HSTS), and renders the production example with `numProxies=1`
- [ ] Frontend serves as UID 10001 on 8080 in both Helm and Compose
- [ ] No NetworkPolicy or CSP resources/headers are shipped by this change
- [ ] Root-owned media volume migrated via the documented command
