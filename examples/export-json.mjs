import { createSnapshot, readOmniFocus } from "../dist/index.js";

const sourcePath = process.argv[2] ?? process.env.OMNIFOCUS_LOCAL_PATH;

if (!sourcePath) {
  console.error("Pass an OmniFocus path as the first argument or set OMNIFOCUS_LOCAL_PATH.");
  process.exit(1);
}

const document = await readOmniFocus({ path: sourcePath });
const snapshot = createSnapshot(document, "all");

console.log(
  JSON.stringify(
    {
      filter: snapshot.filter,
      counts: {
        contexts: snapshot.all.contexts.length,
        folders: snapshot.all.folders.length,
        projects: snapshot.all.projects.length,
        tasks: snapshot.all.tasks.length
      },
      document: snapshot.all
    },
    null,
    2
  )
);
