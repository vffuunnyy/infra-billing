#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const candidates = [
  process.env.PUGRA_BIN,
  ...(process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'pugra')),
  join(homedir(), '.local', 'bin', 'pugra'),
].filter(Boolean);
const binary = candidates.find((candidate) => existsSync(candidate));
if (!binary) {
  console.error('Pugra is not installed. See docs/pugra.md, or set PUGRA_BIN to its executable.');
  process.exit(1);
}

const scoped = new Set(['find', 'refs', 'outline', 'edit', 'rename', 'impact', 'index']);
if (scoped.has(args[0]) && !args.some((arg) => arg === '--root' || arg.startsWith('--root='))) {
  args.push('--root', root);
}
const result = spawnSync(binary, args, { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
