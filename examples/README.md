# Examples

These examples are intended for the repository checkout.

1. Install dependencies with `npm install`
2. Build the package with `npm run build`
3. Run one of the example scripts below with Node.js 20+

## Available Tasks

```bash
node examples/available-tasks.mjs /path/to/OmniFocus.ofocus
```

If you omit the path, the script falls back to `OMNIFOCUS_LOCAL_PATH`.

## Export JSON

```bash
node examples/export-json.mjs /path/to/OmniFocus.ofocus > omnifocus.json
```

## Read An Encrypted Vault

```bash
OMNIFOCUS_PASSWORD=secret node examples/read-vault.mjs /path/to/OmniFocus.ofocus
```
