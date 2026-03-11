#!/usr/bin/env node
import { config as loadEnv } from "dotenv";

import { readOmniFocus } from "../api.js";
import { createSnapshot } from "../snapshot.js";
import { renderTaskChart } from "../render.js";
import type { OmniFocusReaderOptions, TaskStatusFilter } from "../types.js";

loadEnv();

const VALID_FILTERS: TaskStatusFilter[] = ["available", "remaining", "dropped", "completed", "all"];

function parseArgs(argv: string[]): OmniFocusReaderOptions & { filter: TaskStatusFilter; json: boolean } {
  const parsed: OmniFocusReaderOptions & { filter: TaskStatusFilter; json: boolean } = {
    source: "auto",
    readAllPatches: true,
    filter: "available",
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--filter":
        if (!value || !VALID_FILTERS.includes(value as TaskStatusFilter)) {
          throw new Error(`Invalid filter mode. Expected one of: ${VALID_FILTERS.join(", ")}`);
        }
        parsed.filter = value as TaskStatusFilter;
        index += 1;
        break;
      case "--source":
        if (!value || !["auto", "local", "vault"].includes(value)) {
          throw new Error("Invalid source mode. Expected one of: auto, local, vault");
        }
        parsed.source = value as OmniFocusReaderOptions["source"];
        index += 1;
        break;
      case "--path":
        if (!value) {
          throw new Error("Missing value for --path");
        }
        parsed.path = value;
        index += 1;
        break;
      case "--password":
        if (!value) {
          throw new Error("Missing value for --password");
        }
        parsed.password = value;
        index += 1;
        break;
      case "--base-only":
        parsed.readAllPatches = false;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        break;
    }
  }

  return parsed;
}

function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;

  if (code === "EPERM" || code === "EACCES" || message.includes("EPERM") || message.includes("EACCES")) {
    return `${message}\n\nmacOS may be blocking access to the OmniFocus database.\nGrant your terminal app Full Disk Access and Files & Folders access, then restart the terminal and try again.`;
  }

  return message;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const document = await readOmniFocus(args);
    const snapshot = createSnapshot(document, args.filter);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            filter: snapshot.filter,
            counts: {
              contexts: snapshot.all.contexts.length,
              folders: snapshot.filtered.folders.length,
              projects: snapshot.filtered.projects.length,
              tasks: snapshot.filtered.tasks.length,
              inbox: snapshot.partition.inboxFilteredCount
            },
            tasks: snapshot.filtered.tasks,
            projects: snapshot.filtered.projects,
            folders: snapshot.filtered.folders,
            contexts: snapshot.all.contexts
          },
          null,
          2
        )
      );
      return;
    }

    console.log(renderTaskChart(snapshot));
  } catch (error) {
    console.error(formatCliError(error));
    process.exitCode = 1;
  }
}

void main();
