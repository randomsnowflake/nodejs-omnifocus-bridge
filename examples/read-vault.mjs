import { createSnapshot, readOmniFocus, renderTaskChart } from "../dist/index.js";

const vaultPath = process.argv[2] ?? process.env.OMNIFOCUS_VAULT_PATH;
const password = process.env.OMNIFOCUS_PASSWORD;

if (!vaultPath) {
  console.error("Pass a vault path as the first argument or set OMNIFOCUS_VAULT_PATH.");
  process.exit(1);
}

if (!password) {
  console.error("Set OMNIFOCUS_PASSWORD before running this example.");
  process.exit(1);
}

const document = await readOmniFocus({
  source: "vault",
  path: vaultPath,
  password
});

const snapshot = createSnapshot(document, "available");

console.log(renderTaskChart(snapshot));
