# nodejs-omnifocus-bridge

Standalone OmniFocus reader and CLI for:

- the default macOS OmniFocus install
- encrypted OmniFocus vaults

It reads OmniFocus data directly, applies useful task filters, and renders a terminal-friendly ASCII tree.

## Requirements

- Node.js 20+
- macOS for local OmniFocus container access

## Install

```bash
npm install
cp .env.example .env
```

## CLI

```bash
npm run cli:list -- --filter available
npm run cli:list -- --source local
npm run cli:list -- --source vault --path /path/to/OmniFocus.ofocus --password "secret"
npm run cli:list -- --json
```

Options:

- `--filter <available|remaining|dropped|completed|all>`
- `--source <auto|local|vault>`
- `--path <path>`
- `--password <password>`
- `--base-only`
- `--json`

Auto mode resolves sources in this order:

1. `--path`
2. `OMNIFOCUS_LOCAL_PATH`
3. OmniFocus 4 default macOS container path
4. OmniFocus 3 default macOS container path
5. `OMNIFOCUS_VAULT_PATH`

## Library

```ts
import {
  readOmniFocus,
  resolveOmniFocusSource,
  createSnapshot,
  renderTaskChart
} from "nodejs-omnifocus-bridge";
```

## macOS Permissions

If the CLI fails with `EPERM` or `EACCES`, give your terminal app:

- Full Disk Access
- Files and Folders access for the OmniFocus container path

This is especially common for:

- `~/Library/Containers/com.omnigroup.OmniFocus4/...`
- `~/Library/Containers/com.omnigroup.OmniFocus3/...`

After updating permissions, restart the terminal and try again.
