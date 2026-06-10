export const expectedWorkflowModel = "generic-writer";
export const expectedAcceptanceModel = "flash-vibe";

export function resolvePiModelRoles(settings, settingsPath = "settings.json") {
  const workflowDefaults = modelDefaultsField(settings, "modelDefaults");
  const acceptanceDefaults = modelDefaultsField(settings, "testModelDefaults");
  const topLevelDefaultModel = stringField(settings, "defaultModel");
  const topLevelDefaultProvider = stringField(settings, "defaultProvider");

  if (workflowDefaults === undefined) {
    throw new Error(
      `${settingsPath} must define modelDefaults.provider/model/purpose for the NovelFabric workflow runtime role.`
    );
  }
  if (acceptanceDefaults === undefined) {
    throw new Error(
      `${settingsPath} must define testModelDefaults.provider/model/purpose for hard pi acceptance. flash-vibe is reserved for acceptance/testing and must not be inferred from the workflow default.`
    );
  }
  if (workflowDefaults.model !== expectedWorkflowModel) {
    throw new Error(
      `${settingsPath} must use ${expectedWorkflowModel} as the workflow runtime model. Got ${workflowDefaults.model}.`
    );
  }
  if (acceptanceDefaults.model !== expectedAcceptanceModel) {
    throw new Error(
      `${settingsPath} must use ${expectedAcceptanceModel} as the hard acceptance model. Got ${acceptanceDefaults.model}.`
    );
  }
  if (workflowDefaults.model === acceptanceDefaults.model) {
    throw new Error("Workflow and acceptance models must be distinct; flash-vibe is test-only.");
  }
  if (workflowDefaults.purpose !== "production") {
    throw new Error(`${settingsPath} modelDefaults.purpose must be production.`);
  }
  if (acceptanceDefaults.purpose !== "testing") {
    throw new Error(`${settingsPath} testModelDefaults.purpose must be testing.`);
  }
  if (topLevelDefaultModel !== undefined && topLevelDefaultModel !== expectedWorkflowModel) {
    throw new Error(
      `${settingsPath} defaultModel must remain ${expectedWorkflowModel}; ${expectedAcceptanceModel} is test-only.`
    );
  }

  return {
    workflowProvider: workflowDefaults.provider,
    workflowModel: workflowDefaults.model,
    workflowThinking: workflowDefaults.thinking ?? stringField(settings, "defaultThinkingLevel"),
    acceptanceProvider: acceptanceDefaults.provider,
    acceptanceModel: acceptanceDefaults.model,
    acceptanceThinking: acceptanceDefaults.thinking,
    topLevelDefaultProvider,
    topLevelDefaultModel
  };
}

function modelDefaultsField(value, key) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const field = value[key];
    if (field !== null && typeof field === "object" && !Array.isArray(field)) {
      const provider = stringField(field, "provider");
      const model = stringField(field, "model");
      const purpose = stringField(field, "purpose");
      const thinking = stringField(field, "thinking");
      if (provider !== undefined && model !== undefined && purpose !== undefined) {
        return {
          provider,
          model,
          purpose,
          ...(thinking === undefined ? {} : { thinking })
        };
      }
    }
  }
  return undefined;
}

function stringField(value, key) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) return field;
  }
  return undefined;
}
