<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { createBranchImpactReport, createConsistencyReport, createInterview, createSimulationReport, createWritingPrewriteReport, ensureProject, getReport, listReports, type InterviewRecord, type NovelProject, type ReportRecord, type ReportSummary } from '../lib/workspace'
const route = useRoute()
const slug = computed(() => String(route.params.slug))
const project = ref<NovelProject | undefined>()
const reports = ref<ReportSummary[]>([])
const activeReport = ref<ReportRecord | undefined>()
const isBusy = ref(false)
const error = ref('')
const reportQuery = ref('')
const branchId = ref('branch-a')
const chapterId = ref('chapter-001')
const interviewQuestion = ref('你为什么这样行动？')
const interviewAgents = ref('kp,project-auditor')
const activeInterview = ref<InterviewRecord | undefined>()
const showsSystemRoleResults = computed(() => activeReport.value?.body.includes('## 系统角色落盘结果') ?? false)
const activeReportContextHint = computed(() => {
  if (!activeReport.value) return ''
  switch (activeReport.value.kind) {
    case 'simulation':
      return '该推演报告综合了 StoryRAG、StorySwarm 与系统角色落盘结果。'
    case 'consistency':
      return '该一致性审计报告会优先强调 StorySwarm 检查结果与系统角色落盘摘要。'
    case 'branch-impact':
      return '该分支影响分析会结合 branch 元数据、StoryRAG 事实和系统角色落盘结果。'
    case 'writing':
      return '该续写预备报告会结合章节文本、StoryRAG 事实和系统角色落盘结果。'
    default:
      return ''
  }
})
onMounted(async () => {
  project.value = await ensureProject(slug.value)
  reports.value = project.value ? await listReports(project.value.slug).catch(() => []) : []
})
async function generateReport() {
  if (!project.value?.simulation.sessionId || project.value.simulation.round <= 0) return
  isBusy.value = true
  error.value = ''
  try {
    const report = await createSimulationReport(project.value.slug, { sessionId: project.value.simulation.sessionId, round: project.value.simulation.round, query: reportQuery.value || undefined })
    activeReport.value = report
    reports.value = await listReports(project.value.slug)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '生成报告失败'
  } finally {
    isBusy.value = false
  }
}

async function generateConsistencyReport() {
  if (!project.value?.simulation.sessionId || project.value.simulation.round <= 0) return
  isBusy.value = true
  error.value = ''
  try {
    activeInterview.value = undefined
    activeReport.value = await createConsistencyReport(project.value.slug, { sessionId: project.value.simulation.sessionId, round: project.value.simulation.round })
    reports.value = await listReports(project.value.slug)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '生成一致性报告失败'
  } finally {
    isBusy.value = false
  }
}

async function generateBranchImpactReport() {
  if (!project.value) return
  isBusy.value = true
  error.value = ''
  try {
    activeInterview.value = undefined
    activeReport.value = await createBranchImpactReport(project.value.slug, { branchId: branchId.value, query: reportQuery.value || undefined })
    reports.value = await listReports(project.value.slug)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '生成分支影响报告失败'
  } finally {
    isBusy.value = false
  }
}

async function generatePrewriteReport() {
  if (!project.value) return
  isBusy.value = true
  error.value = ''
  try {
    activeInterview.value = undefined
    activeReport.value = await createWritingPrewriteReport(project.value.slug, { chapterId: chapterId.value, query: reportQuery.value || undefined })
    reports.value = await listReports(project.value.slug)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '生成续写预备报告失败'
  } finally {
    isBusy.value = false
  }
}

async function openReport(item: ReportSummary) {
  if (!project.value) return
  activeInterview.value = undefined
  activeReport.value = await getReport(project.value.slug, item.kind, item.id)
}
async function runInterview() {
  if (!project.value?.simulation.sessionId) return
  isBusy.value = true
  error.value = ''
  try {
    activeInterview.value = await createInterview(project.value.slug, project.value.simulation.sessionId, {
      agentIds: interviewAgents.value.split(',').map((item) => item.trim()).filter(Boolean),
      questions: [interviewQuestion.value || '你为什么这样行动？'],
    })
    activeReport.value = undefined
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '采访失败'
  } finally {
    isBusy.value = false
  }
}
</script>
<template>
  <section v-if="project" class="reports-view" data-testid="reports-view">
    <header class="nf-panel hero">
      <div>
        <p class="eyebrow">ReportAgent</p>
        <h1>{{ project.title }} 报告中心</h1>
        <p class="subtitle">基于 StoryRAG、StorySwarm 与 simulation logs 生成带引用的推演报告。</p>
      </div>
      <div class="control-box">
        <label class="nf-label">检索关注点
          <input v-model="reportQuery" class="nf-input" placeholder="角色、伏笔、冲突、规则…" data-testid="report-query-input" />
        </label>
        <button class="nf-button" type="button" :disabled="isBusy || !project.simulation.sessionId || project.simulation.round <= 0" @click="generateReport" data-testid="generate-report-button">{{ isBusy ? '生成中…' : '生成当前推演报告' }}</button>
        <button class="nf-button secondary" type="button" :disabled="isBusy || !project.simulation.sessionId || project.simulation.round <= 0" @click="generateConsistencyReport" data-testid="generate-consistency-report-button">生成一致性审计</button>
        <label class="nf-label">分支 ID
          <input v-model="branchId" class="nf-input" data-testid="branch-id-input" />
        </label>
        <button class="nf-button secondary" type="button" :disabled="isBusy" @click="generateBranchImpactReport" data-testid="generate-branch-impact-button">生成分支影响分析</button>
        <label class="nf-label">章节 ID
          <input v-model="chapterId" class="nf-input" data-testid="chapter-id-input" />
        </label>
        <button class="nf-button secondary" type="button" :disabled="isBusy" @click="generatePrewriteReport" data-testid="generate-prewrite-report-button">生成续写预备报告</button>
        <label class="nf-label">采访对象
          <input v-model="interviewAgents" class="nf-input" data-testid="interview-agents-input" />
        </label>
        <label class="nf-label">采访问题
          <input v-model="interviewQuestion" class="nf-input" data-testid="interview-question-input" />
        </label>
        <button class="nf-button secondary" type="button" :disabled="isBusy || !project.simulation.sessionId" @click="runInterview" data-testid="run-interview-button">生成采访记录</button>
      </div>
    </header>
    <p v-if="error" class="nf-empty">{{ error }}</p>
    <section class="reports-grid">
      <aside class="nf-panel list-pane">
        <div class="nf-panel-header">报告列表 <span class="nf-badge">{{ reports.length }}</span></div>
        <div class="list-body">
          <button v-for="item in reports" :key="`${item.kind}-${item.id}`" class="report-item" type="button" @click="openReport(item)" data-testid="report-list-item">
            <strong>{{ item.title }}</strong>
            <small>{{ item.kind }} · {{ item.path }}</small>
          </button>
          <p v-if="reports.length === 0" class="nf-empty">还没有报告。先推进一轮推演再生成。</p>
        </div>
      </aside>
      <article class="nf-panel viewer-pane">
        <div class="nf-panel-header">报告正文</div>
        <p v-if="showsSystemRoleResults" class="nf-help" data-testid="report-system-role-hint">本报告已纳入系统角色落盘结果摘要，可直接检查 world / rules / audit / random event 的影响。</p>
        <p v-if="activeReportContextHint" class="nf-help" data-testid="report-kind-hint">{{ activeReportContextHint }}</p>
        <pre v-if="activeInterview" class="report-body" data-testid="interview-body">{{ activeInterview.body }}</pre>
        <pre v-else-if="activeReport" class="report-body" data-testid="report-body">{{ activeReport.body }}</pre>
        <p v-else class="nf-empty">选择左侧报告，或生成当前轮次报告/采访记录。</p>
      </article>
    </section>
  </section>
  <p v-else class="nf-empty">项目不存在</p>
</template>
<style scoped>
.reports-view { display: grid; gap: var(--nf-space-4); padding: var(--nf-space-4); }
.hero { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: var(--nf-space-4); padding: var(--nf-space-4); align-items: end; }
.eyebrow { margin: 0 0 8px; color: var(--nf-primary); font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
h1 { margin: 0; font-size: 36px; }
.subtitle { color: var(--nf-muted); }
.control-box { display: grid; gap: var(--nf-space-3); }
.reports-grid { display: grid; grid-template-columns: 360px 1fr; gap: var(--nf-space-4); }
.list-body { display: grid; gap: var(--nf-space-2); padding: var(--nf-space-3); }
.report-item { display: grid; gap: 6px; text-align: left; border: 1px solid var(--nf-border); border-radius: 6px; background: #fff; padding: var(--nf-space-3); }
.report-item small { color: var(--nf-muted); }
.viewer-pane { min-height: 0; }
.report-body { margin: 0; padding: var(--nf-space-4); white-space: pre-wrap; overflow: auto; max-height: 70vh; color: var(--nf-text); }
@media (max-width: 1000px) { .hero, .reports-grid { grid-template-columns: 1fr; } }
</style>
