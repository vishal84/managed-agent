# Run the vacation-scheduler agentic example locally.
# `make up` starts every service the agent needs; `make down` stops them again.
# Everything runs from the repo root — see CLAUDE.md for why.

SHELL := /bin/bash
.DEFAULT_GOAL := help

SERVICES := ./scripts/dev-services.sh
RUN_DIR  := .run

# Defaults to the first address in MANAGER_EMAILS so `make e2e` works with no arguments.
# Lowercased: Auth.js stores the address as Google returns it, and the lookup is case-sensitive.
EMAIL ?= $(shell sed -n 's/^MANAGER_EMAILS=//p' .env 2>/dev/null | head -1 | cut -d, -f1 | tr '[:upper:]' '[:lower:]')

# The agent refuses to create a second out-of-office block over a range one already covers, so
# consecutive runs need distinct dates. This rotates every minute; override START to pin a range.
E2E_OFFSET := $(shell expr \( `date +%s` / 60 \) % 120 + 20)
START ?= $(shell date -v+$(E2E_OFFSET)d +%Y-%m-%d 2>/dev/null || date -d "+$(E2E_OFFSET) days" +%Y-%m-%d)

.PHONY: help up down restart status logs e2e setup install db seed check clean

help: ## Show this help
	@echo "Run the agentic vacation scheduler locally."
	@echo
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-9s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Variables: EMAIL=<address> for e2e, PORT=<port> for the dev server."

up: ## Start the tunnel and dev server, then point the Anthropic agent at them
	@$(SERVICES) up

down: ## Stop everything `make up` started
	@$(SERVICES) down

restart: ## Stop, then start again
	@$(SERVICES) down && $(SERVICES) up

status: ## Show which services are running and which ids are configured
	@$(SERVICES) status

logs: ## Follow the dev server and tunnel logs
	@tail -f $(RUN_DIR)/next.log $(RUN_DIR)/tunnel.log

e2e: ## Approve a request and assert the event lands on Google Calendar (EMAIL=you@example.com)
	@test -n "$(EMAIL)" || { echo "Set EMAIL=you@example.com (or fill in MANAGER_EMAILS)"; exit 1; }
	npm run verify:e2e -- --email $(EMAIL) --start $(START)

setup: ## Re-apply the Anthropic environment and agent from the current .env
	npm run setup:anthropic -- --write

install: ## Install dependencies and generate the Prisma client
	npm install

db: ## Create and apply a Prisma migration
	npm run db:migrate

seed: ## Promote the MANAGER_EMAILS users already in the database
	npm run db:seed

check: ## Typecheck and lint
	npm run typecheck && npm run lint

clean: down ## Stop services and delete their pid and log files
	@rm -rf $(RUN_DIR)
	@echo "Removed $(RUN_DIR)"
