export class CommandFailure extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  public constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "CommandFailure";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isCommandFailure(error: Error): error is CommandFailure {
  return error instanceof CommandFailure;
}
