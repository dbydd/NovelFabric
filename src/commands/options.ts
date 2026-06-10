export type JsonOutputOptions = {
  readonly json?: boolean;
};

export type OutputMode = {
  readonly format: "json";
  readonly source: "explicit-flag" | "default";
};

export function resolveOutputMode(options: JsonOutputOptions): OutputMode {
  return {
    format: "json",
    source: options.json === true ? "explicit-flag" : "default"
  };
}
