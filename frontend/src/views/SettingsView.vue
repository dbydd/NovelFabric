<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ensureProject, getAgent, importNovelText, saveCard, updateAgent, type AgentAssetRecord, type AgentAssetSummary, type CardKind, type NovelProject } from '../lib/workspace'

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

onMounted(async () => {
  project.value = await ensureProject(slug.value)
  const firstCard = project.value?.cards.find((card) => card.kind === activeCardKind.value)
  if (firstCard) selectCard(firstCard.id)
  const firstAgent = project.value?.agents?.[0]
  if (firstAgent) await selectAgent(firstAgent.agentId)
})

function selectCard(id: string) {
  const card = project.value?.cards.find((item) => item.id === id)
  if (!card) return
  selectedCardId.value = id
  cardTitle.value = card.title
  cardBody.value = card.body
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

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !project.value) return
  const text = await file.text()
  const updated = await importNovelText(project.value, file.name, text)
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
          <button class="nf-button accent" type="button" @click="saveCurrentCard" data-testid="save-card-button">保存卡片</button>
        </section>
      </div>
    </main>
    <aside class="agents-pane nf-panel" data-testid="agent-overview">
      <div class="nf-panel-header">Agent 资产</div>
      <div class="agent-layout">
        <div class="agent-list">
          <button v-for="agent in agents" :key="agent.agentId" type="button" class="agent-card" :class="{ active: selectedAgentId === agent.agentId }" @click="selectAgent(agent.agentId)" data-testid="agent-card"><strong>{{ agent.agentId }}</strong><span class="nf-badge">{{ agent.skillCount }} skills</span><small>{{ agent.soulTitle }}</small></button>
        </div>
        <div v-if="selectedAgent" class="agent-editor" data-testid="agent-editor">
          <label class="nf-label">soul.md<textarea v-model="agentSoul" class="nf-textarea agent-textarea" data-testid="agent-soul-input"></textarea></label>
          <label class="nf-label">memory.md<textarea v-model="agentMemory" class="nf-textarea agent-textarea" data-testid="agent-memory-input"></textarea></label>
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
.agent-textarea { min-height: 150px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
@media (max-width: 1150px) { .settings-view { grid-template-columns: 1fr; } .card-grid { grid-template-columns: 1fr; } }
</style>
