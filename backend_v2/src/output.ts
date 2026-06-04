export type SuccessEnvelope<TPayload extends Record<string, object | string | number | boolean | null | readonly object[]>> = {
  readonly ok: true;
  readonly command: string;
  readonly data: TPayload;
};

export type ErrorEnvelope = {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
};

export function writeJson(value: ErrorEnvelope | SuccessEnvelope<Record<string, object | string | number | boolean | null | readonly object[]>>): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
