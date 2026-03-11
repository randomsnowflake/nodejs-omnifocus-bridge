export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

type UnknownElement = {
  tagName: string;
  attributes?: Record<string, string>;
  parentTag?: string;
  filePath?: string;
  parentChain?: string[];
  siblingTags?: string[];
  textContent?: string;
};

export class LoggerService {
  private readonly unknownElements: UnknownElement[] = [];
  private readonly unknownAttributes: Array<{ tagName: string; attrName: string; attrValue?: string }> = [];
  private readonly unknownValues: Array<{ property: string; value: string; parentType?: string }> = [];

  constructor(
    private readonly logLevel: LogLevel = LogLevel.WARN,
    public currentFilePath?: string
  ) {}

  logUnknownElement(element: UnknownElement): void {
    this.unknownElements.push(element);
    if (this.logLevel <= LogLevel.DEBUG) {
      console.warn(`Unknown XML element <${element.tagName}>`);
    }
  }

  logUnknownAttribute(tagName: string, attrName: string, attrValue?: string): void {
    this.unknownAttributes.push({ tagName, attrName, attrValue });
    if (this.logLevel <= LogLevel.DEBUG) {
      console.warn(`Unknown attribute ${tagName}.${attrName}`);
    }
  }

  logUnknownPropertyValue(property: string, value: string, parentType?: string): void {
    this.unknownValues.push({ property, value, parentType });
    if (this.logLevel <= LogLevel.DEBUG) {
      console.warn(`Unknown property value ${property}=${value}`);
    }
  }

  logParseError(error: Error, context?: string): void {
    if (this.logLevel <= LogLevel.ERROR) {
      console.error(context ? `${error.message} (${context})` : error.message);
    }
  }

  log(level: LogLevel, message: string, details?: unknown): void {
    if (level < this.logLevel) {
      return;
    }

    if (level === LogLevel.ERROR) {
      console.error(message, details ?? "");
      return;
    }

    if (level === LogLevel.WARN) {
      console.warn(message, details ?? "");
      return;
    }

    if (level === LogLevel.INFO) {
      console.info(message, details ?? "");
      return;
    }

    console.log(message, details ?? "");
  }

  getSummary(): {
    unknownElements: number;
    unknownAttributes: number;
    unknownValues: number;
  } {
    return {
      unknownElements: this.unknownElements.length,
      unknownAttributes: this.unknownAttributes.length,
      unknownValues: this.unknownValues.length
    };
  }

  reset(): void {
    this.unknownElements.length = 0;
    this.unknownAttributes.length = 0;
    this.unknownValues.length = 0;
  }
}

