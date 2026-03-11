import { createSnapshot, readOmniFocus, renderTaskChart } from "../dist/index.js";

const sourcePath = process.argv[2] ?? process.env.OMNIFOCUS_LOCAL_PATH;

if (!sourcePath) {
  console.error("Pass a local OmniFocus path as the first argument or set OMNIFOCUS_LOCAL_PATH.");
  process.exit(1);
}

const document = await readOmniFocus({ path: sourcePath });
const snapshot = createSnapshot(document, "available");

console.log(renderTaskChart(snapshot));
