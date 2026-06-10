export type AgentRuntimeBridgeStatus = "planned" | "partial" | "disabled" | "available";

export type AgentRuntimeCapability =
  | "project.manage"
  | "workspace.materialize"
  | "knowledge.query"
  | "simulation.append_turn"
  | "external_swarm.run"
  | "memory.recall"
  | "memory.write_own"
  | "files.patch_allowed"
  | "files.patch_protected";

export type AgentRuntimeActor = {
  readonly id: string;
  readonly label: string;
  readonly kind: "main-agent" | "role-agent" | "system-agent";
  readonly capabilities: readonly AgentRuntimeCapability[];
  readonly deniedByDefault: readonly AgentRuntimeCapability[];
};

export type AgentRuntimeLaunchPlan = {
  readonly bridge: "@earendil-works/pi-coding-agent";
  readonly status: AgentRuntimeBridgeStatus;
  readonly cwd: string;
  readonly sessionMode: "in-memory-preview" | "workspace-persistent";
  readonly cliGuardrail: "required";
  readonly notes: readonly string[];
};

export type AgentRuntimeAdapter = {
  readonly name: "pi-coding-agent";
  readonly packageName: "@earendil-works/pi-coding-agent";
  describeLaunchPlan(cwd: string): AgentRuntimeLaunchPlan;
};
