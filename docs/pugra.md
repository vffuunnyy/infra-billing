# Pugra in this repository

[Pugra](https://github.com/ZoVibes/pugra) provides local code navigation through MCP and the CLI. The shared daemon keeps separate indexes for the main checkout and each worktree. `.pugra.toml` controls this repository's index; caches live outside the checkout.

## Install once (macOS Apple Silicon)

Requires Node.js 24.21 or newer and authenticated GitHub CLI access to the Pugra repository:

```sh
gh release download --repo ZoVibes/pugra --pattern install.sh --output - | sh
```

If Pugra is already built from source, run `pugra link` using its existing executable to create the launchers in `~/.local/bin`. The project wrapper also finds that directory when it is absent from `PATH`. Set `PUGRA_BIN=/absolute/path/to/pugra` to use another installation.

## Use from this checkout

```sh
npm run pugra -- --version
npm run pugra -- doctor
npm run pugra -- setup --check
npm run pugra -- outline
npm run pugra -- find TelegramService
npm run pugra -- refs TelegramService --depth 2
npm run pugra -- index --precise --lang ts --wait
```

The wrapper passes this checkout's absolute root for code commands, independent of the shell's working directory. `doctor`, `setup` and `status` report the shared installation. `index --precise` runs the TS language tools; the initial run can take several seconds. Use `setup --lang ts` only if `setup --check` says they are missing. No paid model runs are needed.

## MCP

If the current host already exposes `pugra` tools, use that connection. Otherwise connect once using the installed runtime:

```sh
~/.local/bin/pugra connect codex --no-hooks
# For project-local Claude Code configuration instead:
~/.local/bin/pugra connect claude-code --project --no-hooks
```

Restart the host to load a newly added MCP server. These are alternatives for the host in use, not commands required on every checkout. The checked-in configuration does not install global hooks.

`AGENTS.md` tells agents to start code navigation with `find`, `outline` and `refs`, then read the requested line ranges. After changes outside `edit`, read `impact`. Generated Prisma clients, dependencies, build output and environment files are excluded. Vendored UI primitives remain searchable but are marked external for default reference traversal. `.env.example` is documentation and is not needed in the code index.
