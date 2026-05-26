<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { deleteAgentSkill, deleteCard, ensureProject, getAgent, getLlmEndpoint, getLlmRole, importNovelText, listLlmRoles, saveAgentSkill, saveCard, saveLlmEndpoint, saveLlmRole, updateAgent, type AgentAssetRecord, type AgentAssetSummary, type CardKind, type LlmApiStyle, type LlmEndpointConfig, type LlmRoleConfig, type NovelProject } from '../lib/workspace'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const project = ref<NovelProject | undefined>(undefined)
const activeCardKind = ref<CardKind>('character')
const selectedCardId = ref('')
const importStatus = ref('')
const selectedCard = computed(() => project.value?.cards.find((card) => card.id === selectedCardId.value))
const visibleCards = computed(() => project.value?.cards.filter((card) => card.kind === activeCardKind.value) ?? [])
const cardTitle = ref('')
const cardBody = ref('')
const selectedAgentId = ref('')
const selectedAgent = ref<AgentAssetRecord | undefined>(undefined)
const agentSoul = ref('')
const agentMemory = ref('')
const agents = computed<AgentAssetSummary[]>(() => project.value?.agents ?? [])
const llmProvider = ref('axonhub')
const llmBaseUrl = ref('http://localhost:3000/v1')
const llmApiKey = ref('')
const llmEndpointStyle = ref<LlmApiStyle>('OpenAiChatCompletions')
const llmDefaultModel = ref('generic-writer')
const llmDefaultStyleOverride = ref<'' | LlmApiStyle>('')
const llmRoleId = ref('')
const llmRoleModel = ref('')
const llmRoleStyleOverride = ref<'' | LlmApiStyle>('')
const llmRoles = ref<LlmRoleConfig[]>([])
const llmConfigStatus = ref('')
const skillFileName = ref('character-decision.md')
const skillBody = ref('# character-decision\n')

onMounted(async () => {
  project.value = await ensureProject(slug.value)
  const firstCard = project.value?.cards.find((card) => card.kind === activeCardKind.value)
  if (firstCard) selectCard(firstCard.id)
  const firstAgent = project.value?.agents?.[0]
  if (firstAgent) await selectAgent(firstAgent.agentId)
  const endpoint = await getLlmEndpoint()
  if (endpoint) applyEndpoint(endpoint)
  const defaultRole = await getLlmRole('default')
  if (defaultRole) applyDefaultRole(defaultRole)
  await refreshLlmRoles()
})

function applyEndpoint(endpoint: LlmEndpointConfig) {
  llmProvider.value = endpoint.provider
  llmBaseUrl.value = endpoint.base_url
  llmApiKey.value = endpoint.api_key
  llmEndpointStyle.value = endpoint.api_style
}

function applyDefaultRole(role: LlmRoleConfig) {
  llmDefaultModel.value = role.model
  llmDefaultStyleOverride.value = role.api_style ?? ''
}

async function refreshLlmRoles() {
  try {
    llmRoles.value = await listLlmRoles()
  } catch {
    llmRoles.value = []
  }
}

function selectCard(id: string) {
  const card = project.value?.cards.find((item) => item.id === id)
  if (!card) return
  selectedCardId.value = id
  cardTitle.value = card.title
  cardBody.value = card.body
}

async function removeCurrentCard() {
  if (!project.value || !selectedCard.value) return
  await deleteCard(project.value.slug, selectedCard.value)
  project.value = await ensureProject(project.value.slug)
  selectedCardId.value = project.value?.cards.find((card) => card.kind === activeCardKind.value)?.id ?? ''
  if (selectedCardId.value) selectCard(selectedCardId.value)
}

async function saveCurrentCard() {
  if (!project.value || !selectedCard.value) return
  await saveCard(project.value.slug, { ...selectedCard.value, title: cardTitle.value, body: cardBody.value })
  project.value = await ensureProject(project.value.slug)
}

async function selectAgent(agentId: string) {
  if (!project.value) return
  selectedAgentId.value = agentId
  selectedAgent.value = await getAgent(project.value.slug, agentId)
  agentSoul.value = selectedAgent.value.soul
  agentMemory.value = selectedAgent.value.memory
}

async function saveAgentAsset() {
  if (!project.value || !selectedAgent.value) return
  selectedAgent.value = await updateAgent(project.value.slug, selectedAgent.value.agentId, { soul: agentSoul.value, memory: agentMemory.value })
  project.value = await ensureProject(project.value.slug)
}

async function saveLlmEndpointConfig() {
  await saveLlmEndpoint({ provider: llmProvider.value, base_url: llmBaseUrl.value, api_key: llmApiKey.value, api_style: llmEndpointStyle.value })
  llmConfigStatus.value = '已保存后端 endpoint / key 配置；模型选择仍由默认角色或角色覆盖控制。'
}

async function saveDefaultLlmRole() {
  await saveLlmRole({ role_id: 'default', model: llmDefaultModel.value, api_style: llmDefaultStyleOverride.value || null })
  await refreshLlmRoles()
  llmConfigStatus.value = '已保存默认模型配置；未单独配置的角色会继承它。'
}

function chooseRoleForLlmOverride(agentId: string) {
  const role = llmRoles.value.find((item) => item.role_id === agentId)
  llmRoleId.value = agentId
  llmRoleModel.value = role?.model ?? llmDefaultModel.value
  llmRoleStyleOverride.value = role?.api_style ?? ''
}

async function saveRoleLlmOverride() {
  if (!llmRoleId.value.trim()) return
  await saveLlmRole({ role_id: llmRoleId.value.trim(), model: llmRoleModel.value, api_style: llmRoleStyleOverride.value || null })
  await refreshLlmRoles()
  llmConfigStatus.value = `已保存 ${llmRoleId.value.trim()} 的模型覆盖配置。`
}

async function saveSkill() {
  if (!project.value || !selectedAgent.value) return
  selectedAgent.value = await saveAgentSkill(project.value.slug, selectedAgent.value.agentId, skillFileName.value, skillBody.value)
  project.value = await ensureProject(project.value.slug)
}

async function removeSkill(fileName: string) {
  if (!project.value || !selectedAgent.value) return
  selectedAgent.value = await deleteAgentSkill(project.value.slug, selectedAgent.value.agentId, fileName)
  project.value = await ensureProject(project.value.slug)
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !project.value) return
  const updated = await importNovelText(project.value, file.name, file)
  project.value = updated
  importStatus.value = `已导入 ${file.name}，拆分 ${updated.importReport?.chapterCount ?? 0} 个章节。`
}
</script>

<template>
  <section v-if="project" class="settings-view" data-testid="settings-view">
    <aside class="project-pane nf-panel" data-testid="project-overview">
      <div class="nf-panel-header">项目设定</div>
      <div class="nf-panel-body nf-form">
        <h1>{{ project.title }}</h1>
        <p>{{ project.description }}</p>
        <dl class="stats"><div><dt>Slug</dt><dd>{{ project.slug }}</dd></div><div><dt>卡片</dt><dd>{{ project.cards.length }}</dd></div><div><dt>章节</dt><dd>{{ project.chapters.length }}</dd></div><div><dt>Agent</dt><dd>{{ agents.length }}</dd></div></dl>
        <label class="nf-label" for="novel-upload">上传 txt 小说
          <input id="novel-upload" class="nf-input" type="file" accept=".txt,text/plain" @change="handleImport" data-testid="novel-file-input" />
          <span class="nf-help">导入后写入后端文本资源，项目创建与拆书保持两步走。</span>
        </label>
        <p v-if="importStatus" class="import-status" data-testid="import-status">{{ importStatus }}</p>
        <article v-if="project.importReport" class="import-report" data-testid="import-report"><strong>Import Report</strong><p>{{ project.importReport.sourceName }} · {{ project.importReport.chapterCount }} chapters</p><pre>{{ project.importReport.preview }}</pre></article>
        <section class="llm-config nf-form" data-testid="llm-config-panel">
          <h2>LLM 后端配置</h2>
          <p class="nf-help">Endpoint/API Key 是全局后端连接信息；模型选择单独保存为默认角色配置，具体角色可再覆盖。所有角色初始继承 default。</p>
          <div class="llm-section" data-testid="llm-endpoint-section">
            <h3>后端 Endpoint / Key</h3>
            <label class="nf-label">Provider<input v-model="llmProvider" class="nf-input" data-testid="llm-provider-input" /></label>
            <label class="nf-label">Base URL<input v-model="llmBaseUrl" class="nf-input" data-testid="llm-base-url-input" /></label>
            <label class="nf-label">API Key<input v-model="llmApiKey" class="nf-input" type="password" data-testid="llm-api-key-input" /></label>
            <label class="nf-label">API Style<select v-model="llmEndpointStyle" class="nf-input" data-testid="llm-api-style-select"><option value="OpenAiChatCompletions">pi-agent / OpenAI chat</option><option value="OpenAiResponses">OpenAI responses</option><option value="AnthropicMessages">Anthropic messages</option></select></label>
            <button class="nf-button accent" type="button" @click="saveLlmEndpointConfig" data-testid="save-llm-endpoint-button">保存 Endpoint / Key</button>
          </div>
          <div class="llm-section" data-testid="llm-default-role-section">
            <h3>默认角色模型</h3>
            <label class="nf-label">Default Model<input v-model="llmDefaultModel" class="nf-input" data-testid="llm-model-input" /></label>
            <label class="nf-label">默认角色 API Style 覆盖<select v-model="llmDefaultStyleOverride" class="nf-input" data-testid="llm-default-style-select"><option value="">继承 Endpoint API Style</option><option value="OpenAiChatCompletions">pi-agent / OpenAI chat</option><option value="OpenAiResponses">OpenAI responses</option><option value="AnthropicMessages">Anthropic messages</option></select></label>
            <button class="nf-button accent" type="button" @click="saveDefaultLlmRole" data-testid="save-llm-button">保存默认模型</button>
          </div>
          <div class="llm-section" data-testid="llm-role-override-section">
            <h3>角色模型覆盖</h3>
            <div class="role-pills"><button v-for="agent in agents" :key="`llm-${agent.agentId}`" type="button" class="scope-tab" @click="chooseRoleForLlmOverride(agent.agentId)" data-testid="llm-role-pick-button">{{ agent.agentId }}</button></div>
            <label class="nf-label">Role ID<input v-model="llmRoleId" class="nf-input" data-testid="llm-role-id-input" placeholder="例如 ye-xiao-wei / kp / import" /></label>
            <label class="nf-label">Override Model<input v-model="llmRoleModel" class="nf-input" data-testid="llm-role-model-input" /></label>
            <label class="nf-label">角色 API Style 覆盖<select v-model="llmRoleStyleOverride" class="nf-input" data-testid="llm-role-style-select"><option value="">继承 Endpoint API Style</option><option value="OpenAiChatCompletions">pi-agent / OpenAI chat</option><option value="OpenAiResponses">OpenAI responses</option><option value="AnthropicMessages">Anthropic messages</option></select></label>
            <button class="nf-button secondary" type="button" @click="saveRoleLlmOverride" data-testid="save-role-llm-button">保存角色覆盖</button>
          </div>
          <p v-if="llmConfigStatus" class="import-status" data-testid="llm-config-status">{{ llmConfigStatus }}</p>
          <div class="llm-roles-list" data-testid="llm-roles-list"><strong>已保存角色配置</strong><small v-for="role in llmRoles" :key="role.role_id">{{ role.role_id }} → {{ role.model }}{{ role.api_style ? ` · ${role.api_style}` : ' · 继承 endpoint style' }}</small></div>
        </section>
      </div>
    </aside>
    <main class="card-editor nf-panel" data-testid="card-editor">
      <div class="nf-panel-header">卡片编辑</div>
      <div class="kind-tabs" role="tablist" aria-label="Card kinds">
        <button v-for="kind in ['character','rule','world']" :key="kind" type="button" class="scope-tab" :class="{ active: activeCardKind === kind }" @click="activeCardKind = kind as CardKind; selectCard(visibleCards[0]?.id ?? '')" :data-testid="`card-kind-${kind}`">{{ kind }}</button>
      </div>
      <div class="card-grid">
        <aside class="card-list" data-testid="card-list"><button v-for="card in visibleCards" :key="card.id" type="button" class="card-list-item" @click="selectCard(card.id)" data-testid="card-list-item">{{ card.title }}</button></aside>
        <section class="nf-form card-form">
          <label class="nf-label">标题<input v-model="cardTitle" class="nf-input" data-testid="card-title-input" /></label>
          <label class="nf-label">正文<textarea v-model="cardBody" class="nf-textarea card-body" data-testid="card-body-input"></textarea></label>
          <div class="editor-actions"><button class="nf-button accent" type="button" @click="saveCurrentCard" data-testid="save-card-button">保存卡片</button><button class="nf-button danger" type="button" @click="removeCurrentCard" data-testid="delete-card-button">删除卡片</button></div>
        </section>
      </div>
    </main>
    <aside class="agents-pane nf-panel" data-testid="agent-overview">
      <div class="nf-panel-header">Agent 资产</div>
      <div class="nf-panel-body">
        <p class="nf-help" data-testid="agent-assets-help">这里是 Simulation 页 tuning entrypoint 指向的主要编辑区：先选 Agent，优先检查 skills，再按需要回看 soul / memory。</p>
        <p class="nf-help" data-testid="agent-assets-priority">Priority: skills first. If target / mode still feels wrong, then review soul and memory.</p>
      </div>
      <div class="agent-layout">
        <div class="agent-list">
          <button v-for="agent in agents" :key="agent.agentId" type="button" class="agent-card" :class="{ active: selectedAgentId === agent.agentId }" @click="selectAgent(agent.agentId)" data-testid="agent-card"><strong>{{ agent.agentId }}</strong><span class="nf-badge">{{ agent.skillCount }} skills</span><small>{{ agent.soulTitle }}</small></button>
        </div>
        <div v-if="selectedAgent" class="agent-editor" data-testid="agent-editor">
          <label class="nf-label">soul.md<textarea v-model="agentSoul" class="nf-textarea agent-textarea" data-testid="agent-soul-input"></textarea></label>
          <label class="nf-label">memory.md<textarea v-model="agentMemory" class="nf-textarea agent-textarea" data-testid="agent-memory-input"></textarea></label><section class="skill-manager" data-testid="skill-manager"><strong>skills</strong><button v-for="skill in selectedAgent.skills" :key="skill" class="nf-button danger" type="button" @click="removeSkill(skill)" data-testid="delete-skill-button">删除 {{ skill }}</button><label class="nf-label">skill 文件名<input v-model="skillFileName" class="nf-input" data-testid="skill-file-input" /></label><textarea v-model="skillBody" class="nf-textarea agent-textarea" data-testid="skill-body-input"></textarea><button class="nf-button secondary" type="button" @click="saveSkill" data-testid="save-skill-button">保存 skill</button></section>
          <button class="nf-button accent" type="button" @click="saveAgentAsset" data-testid="save-agent-button">保存 Agent 资产</button>
        </div>
        <p v-else class="nf-empty">暂无 Agent 资产</p>
      </div>
    </aside>
  </section>
  <p v-else class="nf-empty">项目不存在</p>
</template>

<style scoped>
.settings-view { min-height: calc(100vh - var(--nf-header)); display: grid; grid-template-columns: 310px minmax(0, 1fr) 360px; gap: var(--nf-space-3); padding: var(--nf-space-3); }
.project-pane, .card-editor, .agents-pane { min-height: 0; overflow: auto; }
h1 { margin: 0; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--nf-space-2); margin: 0; }
dt { color: var(--nf-muted); font-size: 12px; font-weight: 800; } dd { margin: 0; font-weight: 900; }
.import-status { color: var(--nf-accent); font-weight: 800; }
.import-report { display: grid; gap: 8px; border: 1px solid var(--nf-border); border-radius: 6px; padding: var(--nf-space-3); background: #fff; }
.import-report pre { white-space: pre-wrap; color: var(--nf-muted); max-height: 180px; overflow: auto; }
.kind-tabs { display: flex; gap: 6px; padding: var(--nf-space-3); border-bottom: 1px solid var(--nf-border); }
.scope-tab { border: 1px solid var(--nf-border); border-radius: 6px; background: #fff; padding: 8px 12px; cursor: pointer; font-weight: 800; }
.scope-tab.active { background: var(--nf-primary); color: #fff; }
.card-grid { display: grid; grid-template-columns: 240px 1fr; min-height: 60vh; }
.card-list { border-right: 1px solid var(--nf-border); display: grid; align-content: start; }
.card-list-item { border: 0; border-bottom: 1px solid var(--nf-border); background: #fff; padding: var(--nf-space-3); text-align: left; cursor: pointer; }
.card-form { padding: var(--nf-space-4); }
.card-body { min-height: 42vh; }
.agent-layout { display: grid; gap: var(--nf-space-3); padding: var(--nf-space-3); }
.agent-list { display: grid; gap: var(--nf-space-2); }
.agent-card { display: grid; gap: 4px; border: 1px solid var(--nf-border); border-radius: 6px; padding: var(--nf-space-3); background: #fff; text-align: left; cursor: pointer; }
.agent-card.active { border-left: 4px solid var(--nf-primary); background: var(--nf-panel-muted); }
.agent-card small { color: var(--nf-muted); }
.agent-editor { display: grid; gap: var(--nf-space-3); }
.editor-actions { display: flex; gap: var(--nf-space-2); flex-wrap: wrap; }
.skill-manager, .llm-config, .llm-section, .llm-roles-list { display: grid; gap: var(--nf-space-2); border: 1px solid var(--nf-border); border-radius: 6px; padding: var(--nf-space-3); background: var(--nf-panel-muted); }
.llm-section, .llm-roles-list { background: #fff; }
.llm-section h3 { margin: 0; }
.role-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.llm-roles-list small { color: var(--nf-muted); }
.agent-textarea { min-height: 150px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
@media (max-width: 1150px) { .settings-view { grid-template-columns: 1fr; } .card-grid { grid-template-columns: 1fr; } }
</style>
