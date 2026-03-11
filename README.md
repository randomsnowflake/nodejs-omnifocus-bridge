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
```

Or install the CLI globally:

```bash
npm install -g nodejs-omnifocus-bridge
```

## CLI

```bash
npm run cli:list -- --filter available
npm run cli:list -- --source local
OMNIFOCUS_PASSWORD="secret" npm run cli:list -- --source vault --path /path/to/OmniFocus.ofocus
npm run cli:list -- --json
```

Options:

- `--filter <available|remaining|dropped|completed|all>`
- `--source <auto|local|vault>`
- `--path <path>`
- `--password <password>` (supported, but avoid it because shell history and process lists can expose secrets)
- `--base-only`
- `--json`

If a vault password is required and `OMNIFOCUS_PASSWORD` is not set, the CLI will prompt for it in an interactive terminal.

Environment variables are optional and supported through your shell environment only:

- `OMNIFOCUS_PASSWORD`
- `OMNIFOCUS_LOCAL_PATH`
- `OMNIFOCUS_VAULT_PATH`

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

## Security And Privacy

- The tool reads OmniFocus data directly from your local filesystem; it does not send task data over the network.
- For encrypted vaults, prefer `OMNIFOCUS_PASSWORD` or the interactive password prompt over `--password`.
- Vaults are decrypted into a temporary directory while the command runs so the existing reader pipeline can process the files.
- The temporary directory is removed after normal execution and on common termination signals such as `SIGINT` and `SIGTERM`.
- If the process is force-killed, the operating system may leave temporary decrypted files behind in your temp directory.

## macOS Permissions

If the CLI fails with `EPERM` or `EACCES`, give your terminal app:

- Full Disk Access
- Files and Folders access for the OmniFocus container path

This is especially common for:

- `~/Library/Containers/com.omnigroup.OmniFocus4/...`
- `~/Library/Containers/com.omnigroup.OmniFocus3/...`

After updating permissions, restart the terminal and try again.
