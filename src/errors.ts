export class OmniFocusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DecryptionError extends OmniFocusError {}
export class InvalidPasswordError extends OmniFocusError {}
export class InvalidFileFormatError extends OmniFocusError {}
export class FileVerificationError extends OmniFocusError {}

