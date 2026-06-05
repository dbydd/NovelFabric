export type Environment = {
  readonly home: string | undefined;
  readonly xdgConfigHome: string | undefined;
  readonly platform: NodeJS.Platform;
};

export function readProcessEnvironment(): Environment {
  return {
    home: process.env["HOME"],
    xdgConfigHome: process.env["XDG_CONFIG_HOME"],
    platform: process.platform
  };
}
