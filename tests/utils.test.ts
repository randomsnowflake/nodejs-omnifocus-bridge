import { describe, expect, it } from "vitest";

import { DecryptionError, FileVerificationError, InvalidFileFormatError, InvalidPasswordError } from "../src/errors.js";
import { LogLevel, LoggerService } from "../src/logger.js";
import { HTMLCleaner } from "../src/utils/htmlCleaner.js";
import { OmniFocusFormatter } from "../src/utils/formatter.js";
import { parseNumber } from "../src/utils/number.js";
import { createBaseTask, createContext, createProject } from "./helpers.js";

describe("errors", () => {
  it("assigns class names correctly", () => {
    expect(new DecryptionError("x").name).toBe("DecryptionError");
    expect(new InvalidPasswordError("x").name).toBe("InvalidPasswordError");
    expect(new InvalidFileFormatError("x").name).toBe("InvalidFileFormatError");
    expect(new FileVerificationError("x").name).toBe("FileVerificationError");
  });
});

describe("LoggerService", () => {
  it("tracks unknown values and resets state", () => {
    const logger = new LoggerService(LogLevel.DEBUG);
    logger.logUnknownElement({ tagName: "foo" });
    logger.logUnknownAttribute("task", "mystery", "1");
    logger.logUnknownPropertyValue("status", "weird", "task");
    logger.log(LogLevel.DEBUG, "debug");
    logger.log(LogLevel.INFO, "info");
    logger.log(LogLevel.WARN, "warn");
    logger.log(LogLevel.ERROR, "error");
    logger.logParseError(new Error("boom"), "ctx");

    expect(logger.getSummary()).toEqual({
      unknownElements: 1,
      unknownAttributes: 1,
      unknownValues: 1
    });

    logger.reset();
    expect(logger.getSummary()).toEqual({
      unknownElements: 0,
      unknownAttributes: 0,
      unknownValues: 0
    });
  });
});

describe("parseNumber", () => {
  it("parses integers, floats, and empty strings", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("", 10)).toBeNull();
    expect(parseNumber("not-a-number")).toBeNull();
  });
});

describe("HTMLCleaner", () => {
  it("cleans OmniFocus HTML and supports truncation helpers", () => {
    expect(HTMLCleaner.cleanHTML(null)).toBe("");
    expect(
      HTMLCleaner.cleanHTML('<style>bad</style><p><lit>Hello</lit><br/>World</p><value key="x">gone</value>&amp;', {
        preserveNewlines: true
      })
    ).toBe("Hello\nWorld\n&");
    expect(HTMLCleaner.cleanHTML(".AppleSystemUIFont text", { removeArtifacts: false })).toContain(".AppleSystemUIFont");
    expect(HTMLCleaner.truncate("a".repeat(90), 10)).toBe("aaaaaaa...");
    expect(HTMLCleaner.extractLines("one\n\n" + "b".repeat(20), 2, 10)).toEqual(["one", "bbbbbbb..."]);
  });
});

describe("OmniFocusFormatter", () => {
  it("formats task, project, and context attributes", () => {
    const task = createBaseTask({
      start: new Date("2024-01-01T00:00:00Z"),
      due: new Date("2024-01-03T00:00:00Z"),
      planned: new Date("2024-01-02T00:00:00Z"),
      completed: new Date("2024-01-04T00:00:00Z"),
      repetitionRule: "FREQ=DAILY",
      estimatedMinutes: 90,
      flagged: true,
      availabilityStatus: "blocked_by_project"
    });
    expect(OmniFocusFormatter.getTaskAttributes(task)).toEqual([
      "defer:2024-01-01",
      "due:2024-01-03",
      "plan:2024-01-02",
      "completed:2024-01-04",
      "repeat:FREQ=DAILY",
      "est:1h30m",
      "flagged",
      "blocked:project"
    ]);

    const project = createProject({
      contextId: "ctx-1",
      order: "sequential",
      project: {
        singleton: false,
        reviewInterval: "@1w",
        lastReview: null,
        status: "paused",
        nextReview: null
      }
    });
    const contexts = new Map([["ctx-1", createContext({ id: "ctx-1", name: "Home" })]]);
    expect(OmniFocusFormatter.getProjectType(project)).toBe("sequential");
    expect(OmniFocusFormatter.getProjectAttributes(project, contexts)).toEqual(["@Home", "type:sequential", "[paused]", "review:@1w"]);
    expect(OmniFocusFormatter.getContextAttributes(createContext({ status: "paused" }))).toEqual(["paused"]);
    expect(OmniFocusFormatter.getContextAttributes(createContext({ status: "dropped" }))).toEqual(["dropped"]);
    expect(OmniFocusFormatter.getContextAttributes(createContext())).toEqual([]);
  });
});

