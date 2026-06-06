# AGENTS.md

Guidance for AI agents working in this repository.

## Project status

**Marketplace** is a greenfield repository. As of the initial commit, it contains only `README.md` — no application code, dependency manifests, Docker configuration, CI workflows, or service definitions.

There is nothing to lint, test, build, or run until a stack and project structure are added.

## Tech stack

Not chosen yet. When implementation begins, add the usual artifacts for the chosen stack (for example `package.json`, `pyproject.toml`, `docker-compose.yml`, `.env.example`) and update this file.

## Cursor Cloud specific instructions

### VM toolchain (pre-installed)

The Cloud Agent VM includes common development tools:

| Tool | Notes |
|------|--------|
| Git | Repository is on branch `main`, remote `origin` |
| Node.js | v22.x via nvm (`/home/ubuntu/.nvm`) |
| npm / pnpm / yarn | Available alongside Node |
| Python | 3.12.x with `pip` |

Docker is not required for this repo in its current state.

### Services

No services are defined. There are no dev servers, databases, or background workers to start.

### Update script

The VM update script is a no-op (`true`) because there are no dependencies to refresh on startup. When dependency manifests are added, update the update script in Cursor Cloud settings to run the appropriate install command (for example `npm install`, `pnpm install`, or `pip install -r requirements.txt`).

### Lint / test / build / run

Not applicable until a stack is scaffolded. After adding a project:

1. Document commands here (or link to README sections).
2. Update the VM update script to refresh dependencies.
3. List required services and startup order in this section.

### Git workflow

- Default branch: `main`
- Agent feature branches: `cursor/<descriptive-name>-a970`
