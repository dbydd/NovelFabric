export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type SuccessEnvelope<TPayload extends JsonObject> = {
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

export function writeJson(value: ErrorEnvelope | SuccessEnvelope<JsonObject>): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
