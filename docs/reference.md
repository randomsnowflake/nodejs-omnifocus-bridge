# Public API Reference

## Root Package

Import from `nodejs-omnifocus-bridge` when you want the supported read, snapshot, and render workflow.

### Functions

- `readOmniFocus(options?)`
- `resolveOmniFocusSource(options?)`
- `createSnapshot(document, filter)`
- `createContextTree(document, tasks?)`
- `createInboxTree(document, tasks?)`
- `createProjectTree(document, tasks?)`
- `renderTaskChart(snapshot, options?)`

### Common Types

- `OmniFocusDocument`
- `OmniFocusReaderOptions`
- `OmniFocusSnapshot`
- `OmniFocusSourceMode`
- `OmniFocusSourceResolution`
- `TaskStatusFilter`
- `RenderTaskChartOptions`
- `Task`
- `Project`
- `Context`
- `Folder`
- `TagRelationship`
- `TreeNode`

## Advanced Subpath Imports

The package still exposes lower-level building blocks, but they are intentionally moved out of the root export so the main API stays small and stable.

### `nodejs-omnifocus-bridge/crypto`

- `OmniFocusDecryptor`
- `DocumentKey`
- `DecryptionSession`
- `OmniFocusError`
- `DecryptionError`
- `InvalidPasswordError`
- `InvalidFileFormatError`
- `FileVerificationError`

### `nodejs-omnifocus-bridge/reader`

- `OmniFocusReader`

### `nodejs-omnifocus-bridge/parser`

- `SaxOmniFocusParser`

### `nodejs-omnifocus-bridge/filter`

- `TaskFilterService`

### `nodejs-omnifocus-bridge/utils`

- `LoggerService`
- `LogLevel`
- `HTMLCleaner`
- `OmniFocusFormatter`

## CLI

The published CLI binary is `omnifocus-list`.

```bash
npx omnifocus-list --help
```
