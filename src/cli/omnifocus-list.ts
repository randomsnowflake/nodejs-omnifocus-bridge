#!/usr/bin/env node
import * as readline from "node:readline";

import { readOmniFocus } from "../api.js";
import { createSnapshot } from "../snapshot.js";
import { renderTaskChart } from "../render.js";
import { resolveOmniFocusSource } from "../source/resolveOmniFocusSource.js";
import type { OmniFocusReaderOptions, TaskStatusFilter } from "../types.js";

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

async function promptForPassword(prompt = "OmniFocus password: "): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("A vault password is required. Set OMNIFOCUS_PASSWORD or use --password when running non-interactively.");
  }

  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(process.stdin);

    let password = "";
    const wasRawMode = process.stdin.isRaw;

    const cleanup = (): void => {
      process.stdin.off("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRawMode));
      }
      process.stdin.pause();
    };

    const onKeypress = (_: string, key: readline.Key): void => {
      if (key.name === "return" || key.name === "enter") {
        process.stdout.write("\n");
        cleanup();
        resolve(password);
        return;
      }

      if (key.ctrl && key.name === "c") {
        process.stdout.write("\n");
        cleanup();
        reject(new Error("Password prompt cancelled"));
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        password = password.slice(0, -1);
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta) {
        password += key.sequence;
      }
    };

    process.stdout.write(prompt);
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", onKeypress);
  });
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const source = await resolveOmniFocusSource(args);
    if (source.source === "vault" && !args.password && !process.env.OMNIFOCUS_PASSWORD) {
      args.password = await promptForPassword();
    }

    const document = await readOmniFocus({ ...args, source: source.source, path: source.path });
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
