import type { BaseTask } from "../../types.js";
import type { ParserState } from "../utils/ParserState.js";

export class NoteProcessor {
  constructor(private readonly state: ParserState) {}

  startNoteCollection(): void {
    this.state.collectingNote = true;
    this.state.noteBuffer = "";
  }

  isCollecting(): boolean {
    return this.state.collectingNote;
  }

  appendText(text: string): void {
    this.state.noteBuffer += text;
  }

  appendOpenTag(tagName: string, attrs: Record<string, string>, selfClosing = false): void {
    const attrPairs = Object.entries(attrs)
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ");
    this.state.noteBuffer += `<${tagName}${attrPairs ? ` ${attrPairs}` : ""}${selfClosing ? "/>" : ">"}`;
  }

  appendCloseTag(tagName: string): void {
    this.state.noteBuffer += `</${tagName}>`;
  }

  handleNoteEnd(tagName: string): boolean {
    if (tagName === "note") {
      const parent = this.state.getCurrentParent();
      if (parent && (parent.type === "task" || parent.type === "project")) {
        (parent as BaseTask).note = this.state.noteBuffer.trim();
      }
      this.state.collectingNote = false;
      this.state.noteBuffer = "";
      return true;
    }

    this.appendCloseTag(tagName);
    return false;
  }
}

