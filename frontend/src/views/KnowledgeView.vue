<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ensureProject, insightForge, listStoryGraphEdges, listStoryGraphEpisodes, listStoryGraphNodes, panoramaStoryRag, quickStoryRag, rebuildStoryGraph, type InsightForgeOutput, type NovelProject, type PanoramaSearchOutput, type QuickSearchOutput, type StoryGraphEdge, type StoryGraphEpisode, type StoryGraphNode, type StoryGraphRebuildOutput } from '../lib/workspace'
const route = useRoute()
const slug = computed(() => String(route.params.slug))
const project = ref<NovelProject | undefined>()
const query = ref('')
const isBusy = ref(false)
const error = ref('')
const rebuild = ref<StoryGraphRebuildOutput>()
const nodes = ref<StoryGraphNode[]>([])
const edges = ref<StoryGraphEdge[]>([])
const episodes = ref<StoryGraphEpisode[]>([])
const quick = ref<QuickSearchOutput>()
const panorama = ref<PanoramaSearchOutput>()
const insight = ref<InsightForgeOutput>()
const effectiveQuery = computed(() => query.value.trim() || project.value?.cards.find((card) => card.kind === 'character')?.title || project.value?.title || '')
const graphNodes = computed(() => nodes.value.slice(0, 12).map((node, index, list) => {
  const angle = (Math.PI * 2 * index) / Math.max(list.length, 1)
  const radius = list.length > 1 ? 155 : 0
  return {
    ...node,
    x: 220 + Math.cos(angle) * radius,
    y: 180 + Math.sin(angle) * radius,
  }
}))
const graphNodeLookup = computed(() => new Map(graphNodes.value.map((node) => [node.id, node])))
const graphEdges = computed(() => edges.value.slice(0, 32).map((edge) => ({ ...edge, sourceNode: graphNodeLookup.value.get(edge.source), targetNode: graphNodeLookup.value.get(edge.target) })).filter((edge) => edge.sourceNode && edge.targetNode))
onMounted(async () => {
  project.value = await ensureProject(slug.value)
  query.value = project.value?.cards.find((card) => card.kind === 'character')?.title ?? ''
  await refreshKnowledge()
})
async function refreshKnowledge() {
  if (!project.value) return
  isBusy.value = true
  error.value = ''
  try {
    rebuild.value = await rebuildStoryGraph(project.value.slug)
    nodes.value = await listStoryGraphNodes(project.value.slug)
    edges.value = await listStoryGraphEdges(project.value.slug)
    episodes.value = await listStoryGraphEpisodes(project.value.slug)
    if (effectiveQuery.value) {
      quick.value = await quickStoryRag(project.value.slug, effectiveQuery.value)
      panorama.value = await panoramaStoryRag(project.value.slug, effectiveQuery.value)
      insight.value = await insightForge(project.value.slug, effectiveQuery.value)
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '知识层刷新失败'
  } finally {
    isBusy.value = false
  }
}
</script>
<template>
  <section v-if="project" class="knowledge-view" data-testid="knowledge-view">
    <header class="nf-panel hero">
      <div>
        <p class="eyebrow">StoryGraph → StoryRAG</p>
        <h1>{{ project.title }} 知识层</h1>
        <p class="subtitle">从项目文本派生本地图谱与检索结果；源事实仍回溯到文件路径、时间线与时间点。</p>
      </div>
      <div class="query-box">
        <label class="nf-label">检索问题<input v-model="query" class="nf-input" data-testid="rag-query-input" placeholder="角色、地点、伏笔、冲突…" /></label>
        <button class="nf-button" type="button" :disabled="isBusy" @click="refreshKnowledge" data-testid="rebuild-knowledge-button">{{ isBusy ? '处理中…' : '重建并检索' }}</button>
      </div>
    </header>
    <p v-if="error" class="nf-empty" data-testid="knowledge-error">{{ error }}</p>
    <section class="stats-grid" data-testid="knowledge-stats">
      <article class="nf-panel stat"><strong>{{ rebuild?.nodeCount ?? nodes.length }}</strong><span>Nodes</span></article>
      <article class="nf-panel stat"><strong>{{ rebuild?.edgeCount ?? 0 }}</strong><span>Edges</span></article>
      <article class="nf-panel stat"><strong>{{ rebuild?.episodeCount ?? episodes.length }}</strong><span>Episodes</span></article>
      <article class="nf-panel stat"><strong>{{ rebuild?.chunkCount ?? 0 }}</strong><span>Chunks</span></article>
    </section>
    <section class="knowledge-grid">
      <article class="nf-panel">
        <div class="nf-panel-header">Quick Search <span class="nf-badge">{{ quick?.hits.length ?? 0 }}</span></div>
        <div class="card-list">
          <p v-if="!quick?.hits.length" class="nf-empty">暂无命中。先导入或维护项目文本。</p>
          <div v-for="hit in quick?.hits" :key="`${hit.sourcePath}-${hit.fact}`" class="fact-card" data-testid="rag-hit"><strong>{{ hit.fact }}</strong><small>{{ hit.sourcePath }} <span v-if="hit.timeline">· {{ hit.timeline }}/{{ hit.timepoint }}</span></small></div>
        </div>
      </article>
      <article class="nf-panel">
        <div class="nf-panel-header">Panorama <span class="nf-badge">{{ panorama?.nodes.length ?? 0 }} nodes</span></div>
        <div class="card-list">
          <div v-for="node in panorama?.nodes" :key="node.id" class="fact-card" data-testid="graph-node"><strong>{{ node.name }}</strong><small>{{ node.labels.join(', ') }} · {{ node.sourcePaths.join(', ') }}</small><p>{{ node.summary }}</p></div>
          <p v-if="!panorama?.nodes.length" class="nf-empty">当前问题尚未匹配节点。</p>
        </div>
      </article>
      <article class="nf-panel graph-visual" data-testid="rag-graph-visualization">
        <div class="nf-panel-header">GraphRAG 可视化 <span class="nf-badge">{{ nodes.length }} nodes · {{ edges.length }} edges</span></div>
        <svg class="graph-canvas" viewBox="0 0 440 360" role="img" aria-label="StoryGraph relationship map">
          <line v-for="edge in graphEdges" :key="edge.id" :x1="edge.sourceNode?.x" :y1="edge.sourceNode?.y" :x2="edge.targetNode?.x" :y2="edge.targetNode?.y" class="graph-edge" />
          <g v-for="node in graphNodes" :key="node.id" class="graph-node">
            <circle :cx="node.x" :cy="node.y" r="24" />
            <text :x="node.x" :y="node.y + 42" text-anchor="middle">{{ node.name.slice(0, 10) }}</text>
          </g>
        </svg>
        <div class="edge-list" data-testid="rag-edge-list">
          <p v-if="!edges.length" class="nf-empty">暂无关系边。重建知识层后会显示 MENTIONED_IN / VALID_IN_TIMELINE 等派生关系。</p>
          <small v-for="edge in edges.slice(0, 8)" :key="edge.id">{{ edge.source }} — {{ edge.relation }} → {{ edge.target }} · {{ edge.sourcePath }}</small>
        </div>
      </article>
      <article class="nf-panel wide">
        <div class="nf-panel-header">Insight Forge</div>
        <div class="insight-columns">
          <div><h3>子问题</h3><ul><li v-for="item in insight?.subQueries" :key="item">{{ item }}</li></ul></div>
          <div><h3>风险/影响</h3><ul><li v-for="item in insight?.riskNotes" :key="item">{{ item }}</li></ul></div>
          <div><h3>关系链</h3><ul><li v-for="item in insight?.relationshipChains" :key="item">{{ item }}</li></ul></div>
        </div>
      </article>
    </section>
  </section>
  <p v-else class="nf-empty">项目不存在</p>
</template>
<style scoped>
.knowledge-view { display: grid; gap: var(--nf-space-4); padding: var(--nf-space-4); }
.hero { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: var(--nf-space-4); padding: var(--nf-space-4); align-items: end; }
.eyebrow { margin: 0 0 8px; color: var(--nf-primary); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
h1 { margin: 0; font-size: 36px; }
.subtitle { color: var(--nf-muted); max-width: 760px; }
.query-box { display: grid; gap: var(--nf-space-3); }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--nf-space-3); }
.stat { padding: var(--nf-space-4); display: grid; gap: 4px; }
.stat strong { font-size: 28px; }
.stat span, small { color: var(--nf-muted); }
.knowledge-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--nf-space-4); }
.card-list { display: grid; gap: var(--nf-space-2); padding: var(--nf-space-3); }
.fact-card { display: grid; gap: 6px; border: 1px solid var(--nf-border); border-radius: 6px; padding: var(--nf-space-3); background: #fff; }
.fact-card p { margin: 0; color: var(--nf-muted); }
.wide { grid-column: 1 / -1; }
.graph-visual { overflow: hidden; }
.graph-canvas { width: 100%; min-height: 300px; background: radial-gradient(circle at center, #f8fafc 0, #eef2ff 100%); border-bottom: 1px solid var(--nf-border); }
.graph-edge { stroke: #94a3b8; stroke-width: 2; opacity: 0.8; }
.graph-node circle { fill: #4f46e5; stroke: #fff; stroke-width: 3; filter: drop-shadow(0 6px 12px rgb(79 70 229 / 0.25)); }
.graph-node text { fill: #111827; font-size: 12px; font-weight: 800; }
.edge-list { display: grid; gap: 6px; padding: var(--nf-space-3); }
.edge-list small { color: var(--nf-muted); }
.insight-columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--nf-space-4); padding: var(--nf-space-4); }
.insight-columns h3 { margin: 0 0 8px; }
.insight-columns ul { margin: 0; padding-left: 20px; color: var(--nf-muted); }
@media (max-width: 1000px) { .hero, .knowledge-grid, .insight-columns { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
