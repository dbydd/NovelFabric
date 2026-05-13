<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { advanceSimulation, createSimulationSession, ensureProject, possessCharacter, type NovelProject, type SimulationCharacter } from '../lib/workspace'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const project = ref<NovelProject | undefined>(undefined)
const selectedCharacter = ref('')
const worldState = ref('各角色处境稳定，世界观等待下一轮推演变化。')
const userAction = ref('')

onMounted(async () => {
  project.value = await ensureProject(slug.value)
  selectedCharacter.value = project.value?.cards.find((card) => card.kind === 'character')?.id ?? ''
})

async function possessCharacterForPlay(id: string) { if (!project.value || !project.value.simulation.sessionId) return; const simulation = await possessCharacter(project.value.slug, project.value.simulation.sessionId, id, 'local-user'); selectedCharacter.value = id; project.value = { ...project.value, simulation } }
async function ensureSession() {
  if (!project.value || project.value.simulation.sessionId) return
  const characters: SimulationCharacter[] = (project.value.cards.filter((card) => card.kind === 'character').map((card) => ({ characterId: card.id, displayName: card.title, agenda: card.body.slice(0, 80) || '推动剧情前进', controller: 'agent' as const })))
  if (characters.length === 0) return
  const simulation = await createSimulationSession(project.value.slug, { sessionId: `session-${Date.now()}`, timeline: 'main', timepointId: '0001', title: `${project.value.title} 推演`, characters })
  project.value = { ...project.value, simulation }
}

async function advanceRound() {
  if (!project.value) return
  await ensureSession()
  if (!project.value?.simulation.sessionId) return
  const actions = (project.value.simulation.characters ?? []).map((character) => ({ characterId: character.characterId, summary: character.characterId === selectedCharacter.value ? (userAction.value || `${character.displayName} 根据当前处境采取谨慎行动。`) : `${character.displayName} 保持角色动机并推进局势。` }))
  const simulation = await advanceSimulation(project.value.slug, project.value.simulation.sessionId, {
    characterActions: actions,
    randomEventDirective: '随机事件改变局部环境，推动剧情向下一时间点靠近。',
    worldMaintainerDirective: worldState.value,
    kpDirective: `KP 按规则裁定：${worldState.value}`,
    projectAuditorDirective: '项目审核确认剧情未偏离当前大纲。',
  })
  project.value = { ...project.value, simulation }
  userAction.value = ''
}
const characters = computed(() => project.value?.cards.filter((card) => card.kind === 'character') ?? [])
const systemAgents = ['random-event', 'project-auditor', 'world-maintainer', 'kp']
</script>

<template>
  <section v-if="project" class="simulation-view" data-testid="simulation-view">
    <aside class="timeline-pane nf-panel" data-testid="sim-timeline">
      <div class="nf-panel-header">跑团记录 <span class="nf-badge">Round {{ project.simulation.round }}</span></div>
      <div class="timeline-list">
        <div v-if="project.simulation.logs.length === 0" class="nf-empty">还没有推演记录。</div>
        <article v-for="(log, index) in project.simulation.logs" :key="index" class="log-card" data-testid="simulation-log">
          <strong>R{{ log.round }} · {{ log.actor }}</strong>
          <span class="nf-badge">{{ log.role }}</span>
          <p>{{ log.summary }}</p>
        </article>
      </div>
    </aside>
    <section class="stage-pane" data-testid="sim-stage">
      <div class="nf-panel">
        <div class="nf-panel-header">当前世界状态</div>
        <div class="nf-panel-body">
          <textarea v-model="worldState" class="nf-textarea" aria-label="World state" data-testid="world-state-input"></textarea>
        </div>
      </div>
    </section>
    <aside class="roles-pane nf-panel" data-testid="sim-roles">
      <div class="nf-panel-header">推演角色</div>
      <div class="role-list">
        <article v-for="agent in systemAgents" :key="agent" class="role-card" data-testid="system-agent-card"><strong>{{ agent }}</strong><span class="nf-badge">system</span></article>
        <article v-for="card in characters" :key="card.id" class="role-card" data-testid="character-card"><strong>{{ card.title }}</strong><button class="nf-button secondary" type="button" @click="possessCharacterForPlay(card.id)" :data-testid="`possess-${card.id}`">附身</button></article>
      </div>
    </aside>
    <footer class="control-pane" data-testid="sim-controls">
      <label class="nf-label">附身角色行动
        <textarea v-model="userAction" class="nf-textarea" data-testid="user-action-input"></textarea>
      </label>
      <div class="suggestions" data-testid="suggestions">
        <button v-for="option in ['调查周围', '与角色交谈', '谨慎前进', '改变计划']" :key="option" class="nf-button secondary" type="button" @click="userAction = option">{{ option }}</button>
      </div>
      <button class="nf-button accent" type="button" @click="advanceRound" data-testid="advance-round-button">开始 / 推进自动推演</button>
    </footer>
  </section>
  <p v-else class="nf-empty">项目不存在</p>
</template>

<style scoped>
.simulation-view { height: calc(100vh - var(--nf-header)); display: grid; grid-template-columns: 300px 1fr 300px; grid-template-rows: 1fr auto; gap: var(--nf-space-3); padding: var(--nf-space-3); }
.timeline-pane, .roles-pane, .stage-pane { min-height: 0; overflow: auto; }
.timeline-list, .role-list { display: grid; gap: var(--nf-space-2); padding: var(--nf-space-3); }
.log-card, .role-card { display: grid; gap: 6px; padding: var(--nf-space-3); border: 1px solid var(--nf-border); border-radius: 6px; background: #fff; }
.log-card p { margin: 0; color: var(--nf-muted); }
.control-pane { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--nf-space-3); align-items: end; padding: var(--nf-space-3); background: var(--nf-panel); border: 1px solid var(--nf-border); border-radius: var(--nf-radius); }
.suggestions { display: flex; flex-wrap: wrap; gap: var(--nf-space-2); }
@media (max-width: 1100px) { .simulation-view { grid-template-columns: 1fr; height: auto; } .control-pane { grid-template-columns: 1fr; } }
</style>
