export class HTMLCleaner {
  private static readonly HTML_ENTITIES: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
    "&nbsp;": " ",
    "&#x2019;": "'",
    "&#8217;": "'",
    "&#8220;": "\"",
    "&#8221;": "\"",
    "&#8211;": "-",
    "&#8212;": "--"
  };

  static cleanHTML(
    html: string | null | undefined,
    options?: { preserveNewlines?: boolean; removeArtifacts?: boolean }
  ): string {
    if (!html) {
      return "";
    }

    const preserveNewlines = options?.preserveNewlines ?? true;
    const removeArtifacts = options?.removeArtifacts ?? true;

    let cleaned = html;
    const replacements: Array<[RegExp, string]> = [
      [/<(style|value)[^>]*>[\s\S]*?<\/\1>/gi, ""],
      [/<(lit|run)[^>]*>([\s\S]*?)<\/\1>/gi, "$2"],
      [/<br\s*\/?>/gi, "\n"],
      [/<\/?p[^>]*>/gi, "\n"],
      [/<\/?text[^>]*>/gi, ""]
    ];

    for (const [pattern, replacement] of replacements) {
      cleaned = cleaned.replace(pattern, replacement);
    }

    if (removeArtifacts) {
      cleaned = cleaned.replace(/\.[A-Za-z]+Font|font-family:[^;]+;?|left-to-right|right-to-left/gi, "");
    }

    cleaned = cleaned.replace(/<[^>]+>/g, "");
    cleaned = this.decodeHTMLEntities(cleaned);

    const lines = cleaned
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return preserveNewlines ? lines.join("\n") : lines.join(" ").replace(/\s+/g, " ").trim();
  }

  static truncate(html: string | null | undefined, maxLength = 80): string | null {
    const cleaned = this.cleanHTML(html, { preserveNewlines: false });
    if (!cleaned) {
      return null;
    }

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    return `${cleaned.slice(0, maxLength - 3)}...`;
  }

  static extractLines(html: string | null | undefined, maxLines = 3, maxLength = 80): string[] {
    const cleaned = this.cleanHTML(html);
    if (!cleaned) {
      return [];
    }

    return cleaned
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, maxLines)
      .map((line) => (line.length <= maxLength ? line : `${line.slice(0, maxLength - 3)}...`));
  }

  private static decodeHTMLEntities(text: string): string {
    return text.replace(/&[#\w]+;/g, (match) => this.HTML_ENTITIES[match] ?? match);
  }
}

