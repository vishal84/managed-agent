# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A **vacation scheduler**: employees sign in with Google, request time off (PTO, Sick Day, Bereavement, Other + comments), and a manager approves or denies. When a request is **approved**, the app starts an **Anthropic Managed Agent** session that connects to this app's own **Google Calendar MCP server** and creates an all-day out-of-office block on the employee's calendar, using the employee's own Google OAuth token.

Stack: Next.js 16 (App Router) · Tailwind + shadcn/ui · Auth.js v5 (Google) · Prisma 7 + SQLite · `@anthropic-ai/sdk` (Managed Agents beta) · `mcp-handler` (Streamable HTTP MCP).

## Repository layout

The whole Next.js app — pages, components, API routes, Tailwind, shadcn — lives in `frontend/`. The repo root holds everything that is not Next.js: the package manifest and lockfile, `prisma/`, `scripts/`, `.env`, and the Anthropic agent/environment definitions.

```
.
├── frontend/                 # the Next.js project directory (`next dev frontend`)
│   ├── next.config.ts        # also loads the repo-root .env (see below)
│   ├── tsconfig.json         # the app's config; `@/*` → frontend/src/*
│   ├── eslint.config.mjs     # eslint-config-next; run with frontend/ as the cwd
│   ├── postcss.config.mjs    # Tailwind v4
│   ├── components.json       # shadcn/ui; run the shadcn CLI from frontend/
│   ├── public/
│   ├── src/{app,components,lib,types,generated}/
│   └── AGENTS.md, CLAUDE.md  # generated and maintained by `next dev`; commit them
├── prisma/                   # schema, migrations, seed
├── scripts/                  # setup-anthropic.ts, verify-e2e.ts (tsx, run from the root)
├── tsconfig.json             # root config, covers prisma/ + scripts/ only
├── package.json              # single manifest; one node_modules at the root
├── .env / .env.example       # shared by the app, prisma, and the scripts
├── agent.md / environment.yaml
└── dev.db
```

There is one npm package, not a workspace. Every command is run from the repo root, and Next is pointed at the app with a directory argument (`next dev frontend`). Because npm always runs scripts with the repo root as the working directory, relative paths keep resolving against the root: `DATABASE_URL="file:./dev.db"` still means `./dev.db` at the root, and `import "dotenv/config"` in `frontend/next.config.ts` still finds the root `.env`. That last line matters — Next only looks for `.env` inside its own project directory, so without it the app would see no environment at all.

Server-side code (`frontend/src/lib/*`) is imported both by the app and by the root scripts, which reach it with relative paths like `../frontend/src/lib/prisma`. Prisma generates its client into `frontend/src/generated/prisma`, so the `@/generated/prisma/client` alias resolves the same way in both places.

## How the pieces fit

```
Employee ──Google OAuth──▶ Next.js app ──────────────┐
   │  POST /api/requests (PENDING)                    │ Prisma/SQLite
Manager ── POST /api/requests/:id/decision ───────────┤
   │  APPROVED → after(): startCalendarJob()          │
   ▼                                                  │
Anthropic Managed Agents                              │
   vault (employee's Google token, mcp_oauth) ─┐      │
   session(agent, environment, vault_ids) ─────┤      │
   agent calls MCP tools ─── HTTPS ───▶ /api/mcp ◀────┘  (records calendarEventId)
   │                                     │
   └── webhook /api/webhooks/anthropic   └── Google Calendar API
        (session.status_idled/terminated → reconcileJob)
```

Key files:

| File | Role |
|---|---|
| `frontend/src/auth.ts` | Auth.js config: Google provider with `calendar.events` scope, `access_type=offline`, `prompt=consent`; keeps `Account` tokens fresh; promotes `MANAGER_EMAILS` on first sign-in |
| `prisma/schema.prisma` | `User.role`, `VacationRequest` (approval `status` **separate from** `calendarJobStatus`), vault ids cached on `User` |
| `frontend/src/app/api/mcp/route.ts` | MCP server (`list_events`, `create_out_of_office`). Bearer token = employee's Google access token, injected by Anthropic from the vault; resolved to a `User` via Google userinfo. **Writes `calendarEventId` itself** — the app never parses agent text for it |
| `frontend/src/lib/calendar-agent.ts` | `startCalendarJob` (refresh Google token → upsert vault credential → create session with `initial_events`), `reconcileJob` (reads session events, marks SUCCEEDED/FAILED), `reconcileStaleJobs` |
| `frontend/src/lib/vault.ts` | Per-user vault + `mcp_oauth` credential keyed to `MCP_PUBLIC_URL`; archives/recreates when the URL changes (the URL is immutable on a credential) |
| `frontend/src/lib/agent-definition.ts` | The agent: `mcp_servers` + `mcp_toolset` with `permission_policy: always_allow` (anything else stalls an unattended session). No built-in `agent_toolset` |
| `scripts/setup-anthropic.ts` | Creates/updates the environment + agent from `MCP_PUBLIC_URL`; `--write` updates `.env` |
| `scripts/verify-e2e.ts` | Creates an approved request, runs the agent, asserts the event exists on Google Calendar |
| `agent.md` | Human-readable mirror of the agent definition (`ant apply agent.md` also works after editing the URL) |

## Commands

All of these run from the repo root.

`make up` is the quick path: it applies migrations, starts the tunnel and the dev server, writes the
resulting `MCP_PUBLIC_URL` into `.env`, and re-applies the environment + agent so they point at it.
`make down` stops both services; `make help` lists the rest. It cannot register the Console webhook —
there is no API for that.

```bash
make up                          # tunnel + dev server + environment/agent, ready to use
make down                        # stop them
make e2e EMAIL=alice@example.com # full approval → agent → Google Calendar check

npm install                      # also runs prisma generate
npm run dev                      # next dev frontend → http://localhost:3000
npm run typecheck && npm run lint # typecheck covers frontend/ and the root separately
npm run db:migrate               # prisma migrate dev
npm run db:seed                  # promote MANAGER_EMAILS users already in the DB
npm run setup:anthropic -- --write   # create/update environment + agent, write ids to .env
npm run verify:e2e -- --email alice@example.com
```

## First-time setup

1. `cp .env.example .env` and fill it in (see comments there). Keep it at the repo root, not in `frontend/`.
2. Start a **stable-hostname** tunnel to port 3000 (`cloudflared tunnel run <name>` or `ngrok http 3000 --domain=<reserved>`). `MCP_PUBLIC_URL=https://<host>/api/mcp` must be reachable from Anthropic's servers; a random per-restart URL breaks vault credential matching and requires re-running the setup script.
3. Google Cloud: enable the Calendar API, configure the OAuth consent screen with scope `.../auth/calendar.events` (add test users while in Testing — note refresh tokens expire after 7 days in Testing), and create a Web OAuth client with redirect URIs for `http://localhost:3000/api/auth/callback/google` and `https://<host>/api/auth/callback/google`.
4. `npm run db:migrate`
5. `npm run setup:anthropic -- --write`
6. In the Claude Console, register a webhook at `https://<host>/api/webhooks/anthropic` for `session.status_idled` and `session.status_terminated`; put the signing key in `ANTHROPIC_WEBHOOK_SIGNING_KEY`. Without it, the "Refresh" button on `/manage` (and the 10 s auto-refresh) polls the session instead.
7. `npm run dev`

## Conventions and gotchas

- Paths in `frontend/` use the `@/*` alias for `frontend/src/*`. `prisma/` and `scripts/` sit outside the app and reach the same modules with relative paths; keep both `tsconfig.json` files' `paths` in sync if the alias ever changes.
- Adding a shadcn/ui component means running the CLI with `frontend/` as the working directory, because `components.json` and `globals.css` live there.
- Dates are **date-only**: stored as UTC midnight `DateTime`, moved around as `YYYY-MM-DD` strings (`frontend/src/lib/dates.ts`). Google all-day `end.date` is exclusive; the +1 happens only in `frontend/src/lib/gcal.ts`.
- Approval and calendar sync are separate state machines. A failed sync never rolls back an approval; it shows "Retry calendar" (max 3 attempts).
- The decision route uses `updateMany({ where: { status: "PENDING" } })` as the idempotency guard (second click → 409). `create_out_of_office` is also idempotent per `request_id`.
- Agent inputs are untrusted: the MCP route re-checks that the request belongs to the token's user, is APPROVED, and that the dates match the stored request.
- Managed Agents facts this code relies on: `mcp_servers` and a matching `mcp_toolset` must both be present; `vault_ids` is create-only on a session; credential ↔ server matching is by normalized URL; an invalid credential does not block session creation — it surfaces as `session.error` (`mcp_authentication_failed_error` / `mcp_connection_failed_error`).
- The environment's network policy gates the MCP host. Under `limited` networking the `MCP_PUBLIC_URL` host must be in `allowed_hosts` or `allow_mcp_servers` must be `true`; otherwise `sessions.create` fails with a 400 (`MCP server host(s) blocked by environment network policy`) before the agent runs. `npm run setup:anthropic` re-applies `environment.yaml`'s config on every run to correct Console drift; the change affects new containers only.
- Debugging a stuck job: the session trace URL is logged at creation (`https://platform.claude.com/workspaces/<ws>/sessions/<id>`). `session.error` → vault/URL problem; no `agent.mcp_tool_use` → toolset name mismatch; a pending tool use with an idle session → permission policy is not `always_allow`; `agent.mcp_tool_result.is_error` → check the Next.js server log for the Google error.
- Local dev runs jobs via Next's `after()`; there is no durable queue. For production, put `startCalendarJob` behind a queue and keep `calendarJobStatus` as the state machine.

## References

- Managed Agents: https://platform.claude.com/docs/en/managed-agents/overview
- MCP connector + vaults: https://platform.claude.com/docs/en/managed-agents/mcp-connector, https://platform.claude.com/docs/en/managed-agents/vaults
- Webhooks: https://platform.claude.com/docs/en/managed-agents/webhooks
- mcp-handler: https://github.com/vercel/mcp-handler

## Next.js agent rules

`next dev` writes its managed "This is NOT the Next.js you know" block into the Next.js project directory, which is now `frontend/`. It maintains `frontend/AGENTS.md` and `frontend/CLAUDE.md`; both are committed, and the block no longer appears in this file. Read `frontend/AGENTS.md` before writing app code, and note that `node_modules/` is resolved from the repo root, one level above that file.

## Python Project Rules

<!-- Generated from pydevtools.com, the Python Developer Tooling Handbook -->
<!-- Last verified against: uv 0.12.0, ruff 0.16.6, pyrefly 1.2.0, ty 0.0.78, pytest 9.1.1, prek 0.5.2, pre-commit 4.6.2 -->
<!-- Full explanations: https://pydevtools.com/handbook/explanation/modern-python-project-setup-guide-for-ai-assistants/ -->

## Package management

This project uses uv. Do not use pip, pip-tools, poetry, or conda.

- Add runtime dependency: `uv add <package>` (writes to `[project.dependencies]`)
- Add dev dependency: `uv add --dev <package>` (writes to `[dependency-groups]` per PEP 735)
- Remove dependency: `uv remove <package>`
- Sync environment from lockfile: `uv sync`
- Regenerate lockfile from constraints: `uv lock`
- Upgrade locked versions: `uv lock --upgrade`
- Commit `uv.lock` to version control (current uv guidance is to commit it for applications, CLIs, and libraries)

## Running code

Always use `uv run` to execute Python code and tools. Never call `python`, `pytest`, `ruff`, or other tools directly. They may not resolve to the project's virtual environment.

- Run a script: `uv run python script.py`
- Run a module: `uv run python -m module_name`
- Run a tool: `uv run pytest`, `uv run ruff check .`
- One-off tool (not a project dependency): `uvx <tool>`

## Creating New Projects

- Application or CLI package: `uv init project-name`
- Library without a console script: `uv init --lib project-name`
- Internal script or non-package project: `uv init --no-package project-name`
- Always use `pyproject.toml` for metadata (PEP 621). Never create `setup.py`, `setup.cfg`, or `requirements.txt`.

## Testing

- Framework: pytest
- Run tests: `uv run pytest`
- Test files go in `tests/` at the project root
- Test file naming: `test_*.py`
- Test function naming: `test_*`
- No `__init__.py` needed in `tests/`
- Coverage: `uv add --dev coverage`, then `uv run coverage run -m pytest` and `uv run coverage report`

## Continuous Integration

Use `astral-sh/setup-uv@v7` in GitHub Actions. Let uv install Python and sync the locked environment; do not add a separate `actions/setup-python` step unless the workflow has a specific non-uv requirement.

## Linting and formatting

- Tool: ruff (handles both linting and formatting)
- Lint: `uv run ruff check .`
- Lint and auto-fix: `uv run ruff check --fix .`
- Format: `uv run ruff format .`
- Check formatting: `uv run ruff format --check .`
- Configuration lives in `pyproject.toml` under `[tool.ruff]`

## Type checking

- Tool: pyrefly (preferred), ty, or mypy
- Run: `uv run pyrefly check`, `uv run ty check`, or `uv run mypy .`
- Configuration lives in `pyproject.toml` under `[tool.pyrefly]`, `[tool.ty]`, or `[tool.mypy]`

## Code style

- Follow ruff's defaults for formatting (88 char line length, double quotes, spaces)
- Import sorting is handled by ruff (`isort` rules enabled via `select = ["I"]`)
- Do not add `# type: ignore` comments without an error code

## Pre-commit hooks

- Tool: prek (preferred) or pre-commit
- Install prek hooks: `uvx prek install`
- Install pre-commit hooks: `uvx pre-commit install`
- Do not install pre-commit or prek with pip. Use `uvx`.

## What NOT to do

- Do not create or activate virtual environments manually. uv manages `.venv/` automatically.
- Do not install packages globally or with `pip install`.
- Do not create `requirements.txt` for dependency management. Use `pyproject.toml` and `uv.lock`.
- Do not run `python setup.py` commands.
- Do not add dependencies to pyproject.toml by hand. Use `uv add`.
- If you must edit pyproject.toml directly, write dev dependencies under `[dependency-groups]` (PEP 735), not the legacy `[tool.uv.dev-dependencies]` table.