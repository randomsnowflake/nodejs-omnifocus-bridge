# nodejs-omnifocus-bridge

`nodejs-omnifocus-bridge` is a read-only OmniFocus reader for Node.js and TypeScript.

It understands both OmniFocus database formats:

- the local macOS database used directly by the OmniFocus app
- the encrypted OmniFocus vault format used for synced and self-hosted setups

The package also recreates OmniFocus-style availability logic, so you can work with tasks the way OmniFocus presents them instead of just parsing raw XML.

## What You Get

- a library for reading OmniFocus data into structured JavaScript objects
- a CLI for printing that data as JSON or as a terminal-friendly ASCII tree
- snapshot helpers for `available`, `remaining`, `completed`, `dropped`, or `all` task views

The project is intentionally read-only. It does not modify OmniFocus data.

## Requirements

- Node.js 20+
- macOS for direct access to the local OmniFocus container
- encrypted vault reading also works on non-macOS systems

## Install

Install the library in a project:

```bash
npm install nodejs-omnifocus-bridge
```

Run the CLI without a global install:

```bash
npx --package nodejs-omnifocus-bridge omnifocus-list --help
```

Or install the CLI globally:

```bash
npm install -g nodejs-omnifocus-bridge
```

## CLI Quickstart

Show available tasks from the auto-detected source:

```bash
npx --package nodejs-omnifocus-bridge omnifocus-list --filter available
```

Read the local macOS database explicitly:

```bash
npx --package nodejs-omnifocus-bridge omnifocus-list --source local
```

Read an encrypted vault from disk:

```bash
OMNIFOCUS_PASSWORD="secret" npx --package nodejs-omnifocus-bridge omnifocus-list --source vault --path /path/to/OmniFocus.ofocus
```

Get structured JSON instead of the ASCII view:

```bash
npx --package nodejs-omnifocus-bridge omnifocus-list --json
```

### CLI Options

- `--filter <available|remaining|dropped|completed|all>`
- `--source <auto|local|vault>`
- `--path <path>`
- `--password <password>`: supported, but avoid it because shell history and process lists can expose secrets
- `--base-only`
- `--json`
- `-h, --help`
- `-v, --version`

If a vault password is required and `OMNIFOCUS_PASSWORD` is not set, the CLI prompts for it in an interactive terminal.

### Environment Variables

- `OMNIFOCUS_PASSWORD`
- `OMNIFOCUS_LOCAL_PATH`
- `OMNIFOCUS_VAULT_PATH`

Auto mode resolves sources in this order:

1. `--path`
2. `OMNIFOCUS_LOCAL_PATH`
3. OmniFocus 4 default macOS container path
4. OmniFocus 3 default macOS container path
5. `OMNIFOCUS_VAULT_PATH`

## Library Quickstart

```ts
import {
  createSnapshot,
  readOmniFocus,
  renderTaskChart
} from "nodejs-omnifocus-bridge";

const document = await readOmniFocus({
  source: "local"
});

const snapshot = createSnapshot(document, "available");

console.log(`Available tasks: ${snapshot.filtered.tasks.length}`);
console.log(renderTaskChart(snapshot));
```

## Examples And Reference

- Runnable examples live in [examples/README.md](./examples/README.md)
- Public API reference lives in [docs/reference.md](./docs/reference.md)

Example scripts included in this repository:

- [examples/available-tasks.mjs](./examples/available-tasks.mjs)
- [examples/export-json.mjs](./examples/export-json.mjs)
- [examples/read-vault.mjs](./examples/read-vault.mjs)

## Public API

The root package export is intentionally focused on the main workflow:

- `readOmniFocus`
- `resolveOmniFocusSource`
- `createSnapshot`
- `createContextTree`
- `createInboxTree`
- `createProjectTree`
- `renderTaskChart`

Advanced APIs are still available through explicit subpath imports:

```ts
import { OmniFocusDecryptor } from "nodejs-omnifocus-bridge/crypto";
import { TaskFilterService } from "nodejs-omnifocus-bridge/filter";
import { SaxOmniFocusParser } from "nodejs-omnifocus-bridge/parser";
import { OmniFocusReader } from "nodejs-omnifocus-bridge/reader";
import { LoggerService } from "nodejs-omnifocus-bridge/utils";
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

- `~/Library/Containers/com.omnigroup.OmniFocus4/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus`
- `~/Library/Containers/com.omnigroup.OmniFocus3/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus`

After updating permissions, restart the terminal and try again.

## Development

Useful local commands:

```bash
npm run check
npm run test:coverage
npm run cli:list -- --help
```

## Releases

Push a new version tag and GitHub Actions will publish it to npm automatically:

```bash
npm version patch
git push origin master --follow-tags
```

The publish workflow runs from [`publish.yml`](./.github/workflows/publish.yml) when a tag like `v0.1.2` is pushed. It verifies that the tag matches the version in `package.json`, runs the full check suite, and then publishes to npm.

If you want to inspect the publish payload first:

```bash
npm pack --dry-run
```

The package is published here:

- [npm package](https://www.npmjs.com/package/nodejs-omnifocus-bridge)
- [GitHub releases](https://github.com/randomsnowflake/nodejs-omnifocus-bridge/releases)
