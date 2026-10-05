# Working in infra-billing

## Code navigation: Pugra

This repository is indexed by the `pugra` MCP server. Use its tools before plain text search:

- `find` with `query` locates code by name or meaning; `pattern` finds every regex match with its enclosing symbol.
- `outline` shows a file, directory or repository structure without reading whole files.
- `refs` lists callers and usages. Check it before changing a signature; use `depth` to inspect the impact radius.
- `edit` applies atomic changes and reports affected callers, tests and diagnostics. `rename` previews a symbol rename through the language server.
- After edits through other tools, call `impact` if no Pugra report arrived.

Results contain `path:start-end`: read those lines with normal file tools when you need the implementation. Use `rg` for non-code files or when Pugra has no answer. `syntax: ok` confirms parsing only; still run the relevant build and checks.

From the terminal, `npm run pugra -- <command>` uses this checkout as the root, including in linked worktrees. The wrapper uses an installed Pugra; see `docs/pugra.md` for setup and examples. `.pugra.toml` excludes dependencies, build output, generated Prisma code and secrets. SQL migrations and Prisma schemas stay searchable.

## Validation

This is an npm-workspaces project. Generate Prisma before backend builds (`npm run prisma:generate`), build shared schemas before their consumers (`npm run build:shared`), and run `npm run typecheck` and the checks appropriate to the change. Do not modify unrelated uncommitted work or expose tokens, passwords or encryption keys.
