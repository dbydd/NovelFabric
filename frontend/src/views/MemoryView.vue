<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { createMemoryEntry, ensureProject, listMemoryByScope, updateMemoryEntry, updateProject, type MemoryEntry, type NovelProject } from '../lib/workspace'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const project = ref<NovelProject | undefined>(undefined)
const scope = ref<MemoryEntry['scope']>('global')
const selectedId = ref('')
const selected = computed(() => project.value?.memory.find((entry) => entry.id === selectedId.value))
const title = ref('')
const body = ref('')
const timeline = ref('main')
const timepoint = ref('0001')
const entries = computed(() => project.value?.memory.filter((entry) => entry.scope === scope.value) ?? [])

async function reloadScope() {
  if (!project.value) return
  const scoped = await listMemoryByScope(project.value.slug, scope.value)
  project.value = { ...project.value, memory: scoped }
  const entry = project.value?.memory[0]
  if (entry) {
    selectedId.value = entry.id
    title.value = entry.title
    body.value = entry.body
    timeline.value = entry.timeline
    timepoint.value = entry.timepoint
  }
}

onMounted(async () => {
  project.value = await ensureProject(slug.value)
  await reloadScope()
})

watch(scope, async () => {
  await reloadScope()
})

function select(entry: MemoryEntry) { selectedId.value = entry.id; title.value = entry.title; body.value = entry.body; timeline.value = entry.timeline; timepoint.value = entry.timepoint }
async function createEntry() {
  if (!project.value) return
  const entry: MemoryEntry = { id: `memory-${Date.now()}`, scope: scope.value, timeline: timeline.value || 'main', timepoint: timepoint.value || '0001', title: title.value || '新记忆', body: body.value || '新的记忆内容。' }
  const created = await createMemoryEntry(project.value.slug, entry)
  project.value = { ...project.value, memory: [...project.value.memory, created] }
  select(created)
}
async function saveEntry() {
  if (!project.value || !selected.value) return
  const updated = await updateMemoryEntry(project.value.slug, selected.value, { ...selected.value, title: title.value, body: body.value, timeline: timeline.value, timepoint: timepoint.value })
  project.value = { ...project.value, memory: project.value.memory.map((entry) => entry.id === selected.value?.id ? updated : entry) }
}
</script>

<template>
  <section v-if="project" class="memory-view" data-testid="memory-view">
    <aside class="memory-pane nf-panel" data-testid="memory-sidebar">
      <div class="nf-panel-header">分层记忆 <button class="nf-button" type="button" @click="createEntry" data-testid="new-memory-button">新建</button></div>
      <div class="scope-tabs" role="tablist" aria-label="Memory scopes">
        <button v-for="item in ['global','chapter','agent','branch']" :key="item" class="scope-tab" :class="{ active: scope === item }" type="button" @click="scope = item as MemoryEntry['scope']" :data-testid="`scope-${item}`">{{ item }}</button>
      </div>
      <div class="memory-list">
        <button v-for="entry in entries" :key="entry.id" class="memory-item" type="button" @click="select(entry)" data-testid="memory-entry"><strong>{{ entry.title }}</strong><span>{{ entry.timeline }} / {{ entry.timepoint }}</span></button>
        <p v-if="entries.length === 0" class="nf-empty">该层暂无记忆</p>
      </div>
    </aside>
    <main class="memory-editor nf-panel" data-testid="memory-editor">
      <div class="nf-panel-header">记忆编辑 <span class="nf-badge">{{ scope }}</span></div>
      <div class="nf-panel-body nf-form">
        <label class="nf-label">标题<input v-model="title" class="nf-input" data-testid="memory-title-input" /></label>
        <div class="memory-meta-row"><label class="nf-label">时间线<input v-model="timeline" class="nf-input" data-testid="memory-timeline-input" /></label><label class="nf-label">时间点<input v-model="timepoint" class="nf-input" data-testid="memory-timepoint-input" /></label></div>
        <label class="nf-label">内容<textarea v-model="body" class="nf-textarea memory-body" data-testid="memory-body-input"></textarea></label>
        <button class="nf-button accent" type="button" @click="saveEntry" data-testid="save-memory-button">保存记忆</button>
      </div>
    </main>
    <aside class="card-pane nf-panel" data-testid="card-summary">
      <div class="nf-panel-header">项目卡片</div>
      <div class="nf-panel-body nf-grid">
        <article v-for="card in project.cards" :key="card.id" class="card-summary"><strong>{{ card.title }}</strong><span class="nf-badge">{{ card.kind }}</span><p>{{ card.body }}</p></article>
      </div>
    </aside>
  </section>
  <p v-else class="nf-empty">项目不存在</p>
</template>

<style scoped>
.memory-view { height: calc(100vh - var(--nf-header)); display: grid; grid-template-columns: 300px minmax(0, 1fr) 300px; gap: var(--nf-space-3); padding: var(--nf-space-3); }
.memory-pane, .memory-editor, .card-pane { min-height: 0; overflow: auto; }
.scope-tabs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; padding: var(--nf-space-3); border-bottom: 1px solid var(--nf-border); }
.scope-tab { border: 1px solid var(--nf-border); border-radius: 6px; background: #fff; padding: 8px; cursor: pointer; font-weight: 700; }
.scope-tab.active { background: var(--nf-primary); color: #fff; }
.memory-list { display: grid; }
.memory-item { display: grid; gap: 4px; border: 0; border-bottom: 1px solid var(--nf-border); background: #fff; text-align: left; padding: var(--nf-space-3); cursor: pointer; }
.memory-item span { color: var(--nf-muted); font-size: 13px; }
.memory-meta-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--nf-space-3); }
.memory-body { min-height: 48vh; }
.card-summary { display: grid; gap: 6px; border: 1px solid var(--nf-border); border-radius: 6px; padding: var(--nf-space-3); background: #fff; }
.card-summary p { margin: 0; color: var(--nf-muted); font-size: 13px; }
@media (max-width: 1100px) { .memory-view { grid-template-columns: 1fr; height: auto; } }
</style>
