import type { AgentRuntimeAdapter, AgentRuntimeLaunchPlan } from "./types.js";

export const piAgentRuntimeAdapter: AgentRuntimeAdapter = {
  name: "pi-coding-agent",
  packageName: "@earendil-works/pi-coding-agent",
  describeLaunchPlan(cwd: string): AgentRuntimeLaunchPlan {
    return {
      bridge: "@earendil-works/pi-coding-agent",
      status: "planned",
      cwd,
      sessionMode: "workspace-persistent",
      cliGuardrail: "required",
      notes: [
        "The mono app embeds the pi SDK as a future runtime bridge, not as a direct file mutator.",
        "NovelFabric-managed writes must route through protected CLI primitives and capability manifests.",
        "Role agents remain deny-by-default for protected files, other profiles' memory, and external swarm."
      ]
    };
  }
};

export async function assertPiSdkImportAvailable(): Promise<AgentRuntimeLaunchPlan> {
  const piSdk = await import("@earendil-works/pi-coding-agent");
  if (typeof piSdk.createAgentSession !== "function") {
    throw new Error("@earendil-works/pi-coding-agent createAgentSession export is unavailable.");
  }

  return piAgentRuntimeAdapter.describeLaunchPlan(process.cwd());
}
