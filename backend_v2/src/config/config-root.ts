import path from "node:path";

import type { Environment } from "../environment.js";
import { CommandFailure } from "../errors.js";

export type ConfigRootResolution = {
  readonly configRoot: string;
  readonly source: "xdg-config-home" | "home-default";
  readonly novelfabricDirectory: "novelfabric";
};

export function resolveConfigRoot(environment: Environment): ConfigRootResolution {
  if (environment.xdgConfigHome !== undefined && environment.xdgConfigHome.length > 0) {
    return {
      configRoot: path.resolve(environment.xdgConfigHome, "novelfabric"),
      source: "xdg-config-home",
      novelfabricDirectory: "novelfabric"
    };
  }

  if (environment.home !== undefined && environment.home.length > 0) {
    return {
      configRoot: path.resolve(environment.home, ".config", "novelfabric"),
      source: "home-default",
      novelfabricDirectory: "novelfabric"
    };
  }

  throw new CommandFailure(
    "config_root_unresolved",
    "Cannot resolve NovelFabric config root because neither XDG_CONFIG_HOME nor HOME is set."
  );
}
