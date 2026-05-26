import { desktopApiBase } from './desktop'

export type CardKind = 'character' | 'rule' | 'world'
export type MemoryScopeKind = 'global' | 'chapter' | 'agent' | 'branch'

export interface NovelProject {
  slug: string
  title: string
  description: string
  createdAt: string
  cards: CardRecord[]
  memory: MemoryEntry[]
  chapters: ChapterRecord[]
  simulation: SimulationState
  branches: BranchRecord[]
  importReport?: ImportReport
  agents?: AgentAssetSummary[]
}

export interface CardRecord {
  id: string
  kind: CardKind
  title: string
  body: string
}

export interface MemoryEntry {
  id: string
  scope: MemoryScopeKind
  scopeId?: string
  timeline: string
  timepoint: string
  title: string
  body: string
}

export interface ChapterRecord {
  id: string
  title: string
  body: string
  isCurrent: boolean
  branchId?: string
}

export interface SimulationLog {
  round: number
  actor: string
  role: string
  summary: string
}

export interface SimulationCharacter {
  characterId: string
  displayName: string
  agenda: string
  controller: 'agent' | 'user'
  userId?: string
}

export interface SimulationState {
  sessionId: string
  round: number
  possessedCharacterId: string
  logs: SimulationLog[]
  characters?: SimulationCharacter[]
  timepointId?: string
  title?: string
}

export interface BranchRecord {
  id: string
  title: string
  sourceChapterId: string
  reason: string
  createdAt: string
}

export interface ImportReport {
  sourceName: string
  chapterCount: number
  importedAt: string
  preview: string
}

export interface AgentAssetSummary {
  agentId: string
  soulTitle: string
  skillCount: number
}

export interface AgentAssetRecord extends AgentAssetSummary {
  soul: string
  memory: string
  skills: string[]
}

export interface ReviewNote {
  reviewer: string
  body: string
}

export interface StoryGraphRebuildOutput {
  nodeCount: number
  edgeCount: number
  episodeCount: number
  chunkCount: number
}

export interface StoryGraphNode {
  id: string
  name: string
  labels: string[]
  summary: string
  sourcePaths: string[]
}

export interface StoryGraphEdge {
  id: string
  source: string
  target: string
  relation: string
  fact: string
  validAt?: string | null
  invalidAt?: string | null
  sourcePath: string
}

export interface StoryGraphEpisode {
  id: string
  timeline: string
  timepoint: string
  sourcePath: string
  summary: string
}

export interface StoryRagHit {
  fact: string
  sourcePath: string
  timeline?: string | null
  timepoint?: string | null
  score: number
}

export interface QuickSearchOutput {
  query: string
  hits: StoryRagHit[]
}

export interface PanoramaSearchOutput {
  query: string
  activeFacts: StoryRagHit[]
  historicalFacts: StoryRagHit[]
  nodes: StoryGraphNode[]
  edges: StoryGraphEdge[]
}

export interface InsightForgeOutput {
  query: string
  subQueries: string[]
  facts: StoryRagHit[]
  relationshipChains: string[]
  riskNotes: string[]
}

export interface SwarmConsistencyChecks {
  ooc: string
  world: string
  timeline: string
  rules: string
}

export interface SwarmAgentTurnContext {
  agentId: string
  role: string
  intent: string
  reasoningSummary: string
  evidence: string[]
  consistencyChecks: SwarmConsistencyChecks
  ragHits: StoryRagHit[]
}

export interface SwarmOutputAction {
  type: string
  path?: string
  marker?: string
  old?: string
  new?: string
  content?: string
}

export interface SwarmOutputRecord {
  agentId: string
  role: string
  intent: string
  reasoningSummary: string
  evidence: string[]
  actions: SwarmOutputAction[]
  consistencyChecks: SwarmConsistencyChecks
}

export interface SwarmTurnRecord {
  sessionId: string
  round: number
  timepointId: string
  contexts: SwarmAgentTurnContext[]
  outputs: SwarmOutputRecord[]
}

export type ReportKind = 'simulation' | 'consistency' | 'branch-impact' | 'writing'

export interface ReportSummary {
  id: string
  kind: ReportKind
  title: string
  path: string
}

export interface ReportRecord extends ReportSummary {
  body: string
}

export interface InterviewRecord {
  id: string
  sessionId: string
  path: string
  body: string
}

interface BackendStoryGraphRebuildOutput {
  node_count: number
  edge_count: number
  episode_count: number
  chunk_count: number
}

interface BackendStoryGraphNode {
  id: string
  name: string
  labels: string[]
  summary: string
  source_paths: string[]
}

interface BackendStoryGraphEdge {
  id: string
  source: string
  target: string
  relation: string
  fact: string
  valid_at: string | null
  invalid_at: string | null
  source_path: string
}

interface BackendStoryGraphEpisode {
  id: string
  timeline: string
  timepoint: string
  source_path: string
  summary: string
}

interface BackendStoryRagHit {
  fact: string
  source_path: string
  timeline: string | null
  timepoint: string | null
  score: number
}

interface BackendQuickSearchOutput {
  query: string
  hits: BackendStoryRagHit[]
}

interface BackendPanoramaSearchOutput {
  query: string
  active_facts: BackendStoryRagHit[]
  historical_facts: BackendStoryRagHit[]
  nodes: BackendStoryGraphNode[]
  edges: BackendStoryGraphEdge[]
}

interface BackendInsightForgeOutput {
  query: string
  sub_queries: string[]
  facts: BackendStoryRagHit[]
  relationship_chains: string[]
  risk_notes: string[]
}

interface BackendSwarmConsistencyChecks {
  ooc: string
  world: string
  timeline: string
  rules: string
}

interface BackendSwarmAgentTurnContext {
  agent_id: string
  role: string
  intent: string
  reasoning_summary: string
  evidence: string[]
  consistency_checks: BackendSwarmConsistencyChecks
  rag_hits: BackendStoryRagHit[]
}

interface BackendSwarmAction {
  type: string
  path?: string
  marker?: string
  old?: string
  new?: string
  content?: string
}

interface BackendSwarmOutputRecord {
  agent_id: string
  role: string
  intent: string
  reasoning_summary: string
  evidence: string[]
  actions: BackendSwarmAction[]
  consistency_checks: BackendSwarmConsistencyChecks
}

interface BackendSwarmTurnRecord {
  session_id: string
  round: number
  timepoint_id: string
  contexts: BackendSwarmAgentTurnContext[]
  outputs: BackendSwarmOutputRecord[]
}

interface BackendReportSummary {
  id: string
  kind: ReportKind
  title: string
  path: string
}

interface BackendReportRecord extends BackendReportSummary {
  body: string
}

interface BackendInterviewRecord {
  id: string
  session_id: string
  path: string
  body: string
}

interface ProjectMeta {
  slug: string
  title: string
  description: string
}

interface BackendMemorySummary {
  scope: { kind: string; branch?: string; chapter?: string; agent?: string }
  key: string
  title: string
  timeline: string
  timepoint: string
}

interface BackendMemoryEntry extends BackendMemorySummary {
  body: string
}

interface BackendChapterSummary {
  id: string
  title: string
  is_current: boolean
}

interface BackendChapterRecord {
  id: string
  title: string
  body: string
  review_notes: Array<{ reviewer: string; body: string }>
}

interface BackendCardRecord {
  id: string
  kind: CardKind
  title: string
  body: string
}

interface BackendBranchRecord {
  id: string
  title: string
  description: string
  origin_timepoint_id: string
  timepoint_ids: string[]
}

interface BackendAgentSummary {
  agent_id: string
  soul_title: string
  skill_count: number
}

interface BackendAgentRecord {
  project_slug: string
  agent_id: string
  soul: string
  memory: string
  skills: string[]
}

interface BackendSimulationSession {
  session_id: string
  title: string
  round: number
  timepoint_id: string
  active_character_id: string | null
  characters: Array<{
    character_id: string
    display_name: string
    agenda: string
    controller: { kind: 'agent' } | { kind: 'user_possessed'; user_id: string }
  }>
  logs: Array<{
    round: number
    actor_id: string
    role: string
    summary: string
  }>
}

const STORAGE_KEY = 'novelfabric.projects.v1'
function apiBase(): string {
  return desktopApiBase() ?? ((import.meta.env.VITE_API_BASE as string | undefined) ?? '/novelfabric')
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `project-${Date.now()}`
}

export function loadProjects(): NovelProject[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as NovelProject[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveProjects(projects: NovelProject[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

function defaultProject(title: string, description: string, slug: string): NovelProject {
  return {
    slug,
    title,
    description,
    createdAt: new Date().toISOString(),
    cards: [
      { id: 'world-origin', kind: 'world', title: '世界观设定卡', body: '项目世界观将在导入或手动编辑后沉淀于此。' },
      { id: 'rule-core', kind: 'rule', title: '核心规则卡', body: '推演遵循：角色决策 → 随机事件 → KP 裁定 → 项目审核。' },
      { id: 'character-placeholder', kind: 'character', title: '角色占位卡', body: '导入文本后可替换为真实人物卡。' },
    ],
    memory: [
      { id: 'global-0001', scope: 'global', timeline: 'main', timepoint: '0001', title: '项目初始记忆', body: '项目已创建，等待导入小说文本或手动设定。' },
    ],
    chapters: [
      { id: 'chapter-001', title: '第一章', body: '从这里开始创作当前章节。', isCurrent: true },
    ],
    simulation: { sessionId: '', round: 0, possessedCharacterId: '', logs: [] },
    branches: [],
    agents: [],
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, init)
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function mapMemoryScope(summary: BackendMemorySummary): Pick<MemoryEntry, 'scope' | 'scopeId'> {
  switch (summary.scope.kind) {
    case 'branch':
      return { scope: 'branch', scopeId: summary.scope.branch }
    case 'chapter':
      return { scope: 'chapter', scopeId: summary.scope.chapter }
    case 'agent':
      return { scope: 'agent', scopeId: summary.scope.agent }
    default:
      return { scope: 'global' }
  }
}

function toMemoryEntry(entry: BackendMemoryEntry): MemoryEntry {
  const mapped = mapMemoryScope(entry)
  return {
    id: entry.key,
    scope: mapped.scope,
    scopeId: mapped.scopeId,
    title: entry.title,
    timeline: entry.timeline,
    timepoint: entry.timepoint,
    body: entry.body,
  }
}

function memoryPath(entry: MemoryEntry): string {
  const scopeId = entry.scopeId ?? 'root'
  return `/api/projects/${encodeURIComponent(entryProjectSlugHack(entry))}/memory/${entry.scope}/${encodeURIComponent(scopeId)}/${encodeURIComponent(entry.timeline)}/${encodeURIComponent(entry.timepoint)}/${encodeURIComponent(entry.id)}`
}

function entryProjectSlugHack(_entry: MemoryEntry): string {
  return ''
}

function toAgentSummary(agent: BackendAgentSummary): AgentAssetSummary {
  return { agentId: agent.agent_id, soulTitle: agent.soul_title, skillCount: agent.skill_count }
}

function toAgentRecord(agent: BackendAgentRecord): AgentAssetRecord {
  return {
    agentId: agent.agent_id,
    soulTitle: agent.soul.split('\n').find((line) => line.startsWith('# '))?.slice(2).trim() || agent.agent_id,
    skillCount: agent.skills.length,
    soul: agent.soul,
    memory: agent.memory,
    skills: agent.skills,
  }
}

async function fetchProjectAgents(slug: string): Promise<AgentAssetSummary[]> {
  try {
    const agents = await fetchJson<BackendAgentSummary[]>(`/api/projects/${encodeURIComponent(slug)}/agents`)
    return agents.map(toAgentSummary)
  } catch {
    return []
  }
}

async function fetchProjectCards(slug: string): Promise<CardRecord[]> {
  try {
    return await fetchJson<BackendCardRecord[]>(`/api/projects/${encodeURIComponent(slug)}/cards`)
  } catch {
    return []
  }
}

async function fetchProjectMemory(slug: string): Promise<MemoryEntry[]> {
  let summaries: BackendMemorySummary[]
  try {
    summaries = await fetchJson<BackendMemorySummary[]>(`/api/projects/${encodeURIComponent(slug)}/memory?scope=global`)
  } catch {
    return []
  }
  const detailed = await Promise.all(
    summaries.map((summary) => {
      const scope = mapMemoryScope(summary)
      const scopeId = scope.scopeId ?? 'root'
      return fetchJson<BackendMemoryEntry>(
        `/api/projects/${encodeURIComponent(slug)}/memory/${scope.scope}/${encodeURIComponent(scopeId)}/${encodeURIComponent(summary.timeline)}/${encodeURIComponent(summary.timepoint)}/${encodeURIComponent(summary.key)}`,
      )
    }),
  )
  return detailed.map(toMemoryEntry)
}

async function fetchProjectChapters(slug: string): Promise<ChapterRecord[]> {
  let summaries: BackendChapterSummary[]
  try {
    summaries = await fetchJson<BackendChapterSummary[]>(`/api/projects/${encodeURIComponent(slug)}/writing/chapters`)
  } catch {
    return []
  }
  const records = await Promise.all(
    summaries.map((summary) => fetchJson<BackendChapterRecord>(`/api/projects/${encodeURIComponent(slug)}/writing/chapters/${encodeURIComponent(summary.id)}`)),
  )
  return records.map((record) => ({ id: record.id, title: record.title, body: record.body, isCurrent: summaries.find((item) => item.id === record.id)?.is_current ?? false }))
}

async function fetchProjectBranches(slug: string): Promise<BranchRecord[]> {
  let records: BackendBranchRecord[]
  try {
    records = await fetchJson<BackendBranchRecord[]>(`/api/projects/${encodeURIComponent(slug)}/timeline/branches`)
  } catch {
    return []
  }
  return records.map((record) => ({
    id: record.id,
    title: record.title,
    sourceChapterId: record.origin_timepoint_id,
    reason: record.description,
    createdAt: '',
  }))
}

function toSimulationState(session: BackendSimulationSession | undefined): SimulationState {
  if (!session) return { sessionId: '', round: 0, possessedCharacterId: '', logs: [] }
  return {
    sessionId: session.session_id,
    round: session.round,
    possessedCharacterId: session.active_character_id ?? '',
    timepointId: session.timepoint_id,
    title: session.title,
    characters: session.characters.map((character) => ({
      characterId: character.character_id,
      displayName: character.display_name,
      agenda: character.agenda,
      controller: character.controller.kind === 'user_possessed' ? 'user' : 'agent',
      userId: character.controller.kind === 'user_possessed' ? character.controller.user_id : undefined,
    })),
    logs: session.logs.map((entry) => ({ round: entry.round, actor: entry.actor_id, role: entry.role, summary: entry.summary })),
  }
}

async function fetchLatestSimulation(slug: string, project: NovelProject): Promise<SimulationState> {
  const memoryEntry = project.memory.find((entry) => entry.scope === 'agent' && entry.scopeId === 'kp')
  try {
    const active = await fetchJson<BackendSimulationSession | null>(`/api/projects/${encodeURIComponent(slug)}/simulation/active-session`)
    if (active) return toSimulationState(active)
  } catch {
    // ignore and fall back to known session id
  }
  if (project.simulation.sessionId) {
    try {
      const session = await fetchJson<BackendSimulationSession>(`/api/projects/${encodeURIComponent(slug)}/simulation/sessions/${encodeURIComponent(project.simulation.sessionId)}`)
      return toSimulationState(session)
    } catch {
      // ignore and fall back
    }
  }
  return {
    sessionId: '',
    round: 0,
    possessedCharacterId: '',
    logs: [],
    timepointId: memoryEntry?.timepoint ?? '0001',
  }
}

export async function hydrateProject(meta: ProjectMeta): Promise<NovelProject> {
  const local = getProject(meta.slug) ?? defaultProject(meta.title, meta.description, meta.slug)
  const cards = await fetchProjectCards(meta.slug).catch(() => local.cards)
  const memory = await fetchProjectMemory(meta.slug).catch(() => local.memory)
  const chapters = await fetchProjectChapters(meta.slug).catch(() => local.chapters)
  const branches = await fetchProjectBranches(meta.slug).catch(() => local.branches)
  const agents = await fetchProjectAgents(meta.slug).catch(() => local.agents ?? [])
  const hydratedBase = { ...local, cards, memory, chapters, branches }
  const fetchedSimulation = await fetchLatestSimulation(meta.slug, hydratedBase).catch(() => local.simulation)
  const simulation = fetchedSimulation.sessionId || fetchedSimulation.logs.length > 0 || fetchedSimulation.round > 0
    ? fetchedSimulation
    : local.simulation
  return {
    ...local,
    slug: meta.slug,
    title: meta.title,
    description: meta.description,
    cards,
    memory,
    chapters,
    branches,
    agents,
    simulation,
  }
}

export async function ensureProject(slug: string): Promise<NovelProject | undefined> {
  try {
    const meta = await fetchJson<ProjectMeta>(`/api/projects/${encodeURIComponent(slug)}`)
    const project = await hydrateProject(meta)
    updateProject(project)
    return project
  } catch {
    const local = getProject(slug)
    if (local) return local
    const synced = await syncProjectsFromBackend()
    return synced.find((project) => project.slug === slug)
  }
}

export async function createProject(title: string, description: string): Promise<NovelProject> {
  let slug = slugify(title)
  const localProjects = loadProjects()
  if (localProjects.some((project) => project.slug === slug)) {
    slug = `${slug}-${Date.now()}`
  }

  try {
    await fetchJson<ProjectMeta>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title, description }),
    })
  } catch {
    const fallback = defaultProject(title, description, slug)
    localProjects.unshift(fallback)
    saveProjects(localProjects)
    return fallback
  }

  const project = await ensureProject(slug)
  return project ?? defaultProject(title, description, slug)
}

export async function syncProjectsFromBackend(): Promise<NovelProject[]> {
  try {
    const remote = await fetchJson<ProjectMeta[]>('/api/projects')
    const local = loadProjects()
    const hydrated = await Promise.all(remote.map(async (meta) => {
      try {
        return await hydrateProject(meta)
      } catch {
        return local.find((project) => project.slug === meta.slug) ?? defaultProject(meta.title, meta.description, meta.slug)
      }
    }))
    saveProjects(hydrated)
    return hydrated
  } catch {
    return loadProjects()
  }
}

export function getProject(slug: string): NovelProject | undefined {
  return loadProjects().find((project) => project.slug === slug)
}

export function updateProject(updated: NovelProject): void {
  const projects = loadProjects()
  const index = projects.findIndex((project) => project.slug === updated.slug)
  if (index >= 0) projects[index] = updated
  else projects.unshift(updated)
  saveProjects(projects)
}

export function splitTextIntoChapters(text: string): Array<{ title: string; body: string }> {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  const lines = normalized.split('\n')
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => /^第[0-9一二三四五六七八九十百千万〇零两]+[章节]/.test(line))
  if (headings.length === 0) {
    return [{ title: lines.find((line) => line.trim())?.trim().slice(0, 40) || '导入文本', body: normalized }]
  }
  return headings.map((heading, position) => {
    const next = headings[position + 1]?.index ?? lines.length
    return { title: heading.line, body: lines.slice(heading.index, next).join('\n').trim() }
  })
}

export async function importNovelText(project: NovelProject, sourceName: string, text: string): Promise<NovelProject> {
  try {
    const form = new FormData()
    form.append('sourceName', sourceName)
    form.append('file', new Blob([text], { type: 'text/plain' }), sourceName)
    await fetch(`${apiBase()}/api/projects/${encodeURIComponent(project.slug)}/import`, {
      method: 'POST',
      body: form,
    })
    const refreshed = await ensureProject(project.slug)
    if (refreshed) return refreshed
  } catch {
    // fall back to local-only preview
  }

  const chapters = splitTextIntoChapters(text)
  const importedChapters = chapters.map((chapter, index) => ({
    id: `import-${String(index + 1).padStart(3, '0')}`,
    title: chapter.title,
    body: chapter.body,
    isCurrent: false,
  }))
  const preview = text.slice(0, 500)
  const updated: NovelProject = {
    ...project,
    importReport: { sourceName, chapterCount: importedChapters.length, importedAt: new Date().toISOString(), preview },
    chapters: [...importedChapters, ...project.chapters],
    memory: [
      ...project.memory,
      ...importedChapters.slice(0, 8).map((chapter, index) => ({
        id: `import-memory-${index + 1}`,
        scope: 'chapter' as const,
        timeline: 'imported-story',
        timepoint: String(index + 1).padStart(4, '0'),
        title: chapter.title,
        body: chapter.body.slice(0, 360),
      })),
    ],
    cards: [
      ...project.cards,
      { id: `world-import-${Date.now()}`, kind: 'world', title: `导入概览：${sourceName}`, body: `导入 ${importedChapters.length} 个章节。\n\n${preview}` },
    ],
  }
  updateProject(updated)
  return updated
}

export async function saveCard(projectSlug: string, card: CardRecord): Promise<CardRecord> {
  return fetchJson(`/api/projects/${encodeURIComponent(projectSlug)}/cards/${encodeURIComponent(card.kind)}/${encodeURIComponent(card.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  })
}

export async function listMemoryByScope(projectSlug: string, scope: MemoryScopeKind): Promise<MemoryEntry[]> {
  const summaries = await fetchJson<BackendMemorySummary[]>(`/api/projects/${encodeURIComponent(projectSlug)}/memory?scope=${encodeURIComponent(scope)}`)
  const detailed = await Promise.all(
    summaries.map((summary) => {
      const mapped = mapMemoryScope(summary)
      const scopeId = mapped.scopeId ?? 'root'
      return fetchJson<BackendMemoryEntry>(`/api/projects/${encodeURIComponent(projectSlug)}/memory/${mapped.scope}/${encodeURIComponent(scopeId)}/${encodeURIComponent(summary.timeline)}/${encodeURIComponent(summary.timepoint)}/${encodeURIComponent(summary.key)}`)
    }),
  )
  return detailed.map(toMemoryEntry)
}

export async function createMemoryEntry(projectSlug: string, entry: MemoryEntry): Promise<MemoryEntry> {
  const record = await fetchJson<BackendMemoryEntry>(`/api/projects/${encodeURIComponent(projectSlug)}/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope_kind: entry.scope,
      scope_id: entry.scopeId,
      key: entry.id,
      title: entry.title,
      timeline: entry.timeline,
      timepoint: entry.timepoint,
      body: entry.body,
    }),
  })
  return toMemoryEntry(record)
}

export async function updateMemoryEntry(projectSlug: string, original: MemoryEntry, updated: MemoryEntry): Promise<MemoryEntry> {
  const scopeId = original.scopeId ?? 'root'
  const record = await fetchJson<BackendMemoryEntry>(`/api/projects/${encodeURIComponent(projectSlug)}/memory/${original.scope}/${encodeURIComponent(scopeId)}/${encodeURIComponent(original.timeline)}/${encodeURIComponent(original.timepoint)}/${encodeURIComponent(original.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope_kind: updated.scope,
      scope_id: updated.scopeId,
      key: updated.id,
      title: updated.title,
      timeline: updated.timeline,
      timepoint: updated.timepoint,
      body: updated.body,
    }),
  })
  return toMemoryEntry(record)
}

export async function createChapter(projectSlug: string, chapter: Pick<ChapterRecord, 'id' | 'title' | 'body'>): Promise<ChapterRecord> {
  const record = await fetchJson<BackendChapterRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/writing/chapters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chapter),
  })
  const refreshed = await fetchProjectChapters(projectSlug)
  return refreshed.find((entry) => entry.id === record.id) ?? { id: record.id, title: record.title, body: record.body, isCurrent: false }
}

export async function updateChapter(projectSlug: string, chapterId: string, input: Pick<ChapterRecord, 'title' | 'body'>): Promise<ChapterRecord> {
  const record = await fetchJson<BackendChapterRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/writing/chapters/${encodeURIComponent(chapterId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const refreshed = await fetchProjectChapters(projectSlug)
  return refreshed.find((entry) => entry.id === record.id) ?? { id: record.id, title: record.title, body: record.body, isCurrent: false }
}

export async function createWritingBranch(projectSlug: string, payload: { sourceChapterId: string; branchId: string; branchTitle: string; branchDescription: string; branchReason: string; originTimepointId: string }): Promise<void> {
  await fetchJson(`/api/projects/${encodeURIComponent(projectSlug)}/writing/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_chapter_id: payload.sourceChapterId,
      branch_id: payload.branchId,
      branch_title: payload.branchTitle,
      branch_description: payload.branchDescription,
      branch_reason: payload.branchReason,
      origin_timepoint_id: payload.originTimepointId,
    }),
  })
}

export async function createSimulationSession(projectSlug: string, payload: { sessionId: string; timeline: string; timepointId: string; title: string; characters: SimulationCharacter[] }): Promise<SimulationState> {
  const session = await fetchJson<BackendSimulationSession>(`/api/projects/${encodeURIComponent(projectSlug)}/simulation/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: payload.sessionId,
      timeline: payload.timeline,
      timepoint_id: payload.timepointId,
      title: payload.title,
      characters: payload.characters.map((character) => ({
        character_id: character.characterId,
        display_name: character.displayName,
        agenda: character.agenda,
      })),
    }),
  })
  return toSimulationState(session)
}

export async function possessCharacter(projectSlug: string, sessionId: string, characterId: string, userId: string): Promise<SimulationState> {
  const session = await fetchJson<BackendSimulationSession>(`/api/projects/${encodeURIComponent(projectSlug)}/simulation/sessions/${encodeURIComponent(sessionId)}/possess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id: characterId, user_id: userId }),
  })
  return toSimulationState(session)
}

export async function advanceSimulation(projectSlug: string, sessionId: string, payload: { characterActions: Array<{ characterId: string; summary: string }>; randomEventDirective?: string; worldMaintainerDirective?: string; kpDirective?: string; projectAuditorDirective?: string; auditorConcludesSession?: boolean }): Promise<SimulationState> {
  const session = await fetchJson<BackendSimulationSession>(`/api/projects/${encodeURIComponent(projectSlug)}/simulation/sessions/${encodeURIComponent(sessionId)}/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_actions: payload.characterActions.map((action) => ({ character_id: action.characterId, summary: action.summary })),
      random_event_directive: payload.randomEventDirective,
      world_maintainer_directive: payload.worldMaintainerDirective,
      kp_directive: payload.kpDirective,
      project_auditor_directive: payload.projectAuditorDirective,
      auditor_concludes_session: payload.auditorConcludesSession ?? false,
    }),
  })
  return toSimulationState(session)
}


export async function listAgents(projectSlug: string): Promise<AgentAssetSummary[]> {
  const agents = await fetchJson<BackendAgentSummary[]>(`/api/projects/${encodeURIComponent(projectSlug)}/agents`)
  return agents.map(toAgentSummary)
}

export async function getAgent(projectSlug: string, agentId: string): Promise<AgentAssetRecord> {
  const agent = await fetchJson<BackendAgentRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/agents/${encodeURIComponent(agentId)}`)
  return toAgentRecord(agent)
}

export async function updateAgent(projectSlug: string, agentId: string, input: Pick<AgentAssetRecord, 'soul' | 'memory'>): Promise<AgentAssetRecord> {
  const agent = await fetchJson<BackendAgentRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return toAgentRecord(agent)
}

export async function addReviewNote(projectSlug: string, chapterId: string, note: ReviewNote): Promise<ReviewNote[]> {
  return fetchJson<ReviewNote[]>(`/api/projects/${encodeURIComponent(projectSlug)}/writing/chapters/${encodeURIComponent(chapterId)}/review-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  })
}

function toStoryGraphNode(node: BackendStoryGraphNode): StoryGraphNode {
  return { id: node.id, name: node.name, labels: node.labels, summary: node.summary, sourcePaths: node.source_paths }
}

function toStoryGraphEdge(edge: BackendStoryGraphEdge): StoryGraphEdge {
  return { id: edge.id, source: edge.source, target: edge.target, relation: edge.relation, fact: edge.fact, validAt: edge.valid_at, invalidAt: edge.invalid_at, sourcePath: edge.source_path }
}

function toStoryGraphEpisode(episode: BackendStoryGraphEpisode): StoryGraphEpisode {
  return { id: episode.id, timeline: episode.timeline, timepoint: episode.timepoint, sourcePath: episode.source_path, summary: episode.summary }
}

function toStoryRagHit(hit: BackendStoryRagHit): StoryRagHit {
  return { fact: hit.fact, sourcePath: hit.source_path, timeline: hit.timeline, timepoint: hit.timepoint, score: hit.score }
}

export async function rebuildStoryGraph(projectSlug: string): Promise<StoryGraphRebuildOutput> {
  const output = await fetchJson<BackendStoryGraphRebuildOutput>(`/api/projects/${encodeURIComponent(projectSlug)}/knowledge/rebuild`, { method: 'POST' })
  return { nodeCount: output.node_count, edgeCount: output.edge_count, episodeCount: output.episode_count, chunkCount: output.chunk_count }
}

export async function listStoryGraphNodes(projectSlug: string): Promise<StoryGraphNode[]> {
  const nodes = await fetchJson<BackendStoryGraphNode[]>(`/api/projects/${encodeURIComponent(projectSlug)}/knowledge/graph/nodes`)
  return nodes.map(toStoryGraphNode)
}

export async function listStoryGraphEpisodes(projectSlug: string): Promise<StoryGraphEpisode[]> {
  const episodes = await fetchJson<BackendStoryGraphEpisode[]>(`/api/projects/${encodeURIComponent(projectSlug)}/knowledge/graph/episodes`)
  return episodes.map(toStoryGraphEpisode)
}

export async function quickStoryRag(projectSlug: string, query: string): Promise<QuickSearchOutput> {
  const output = await fetchJson<BackendQuickSearchOutput>(`/api/projects/${encodeURIComponent(projectSlug)}/rag/quick?query=${encodeURIComponent(query)}`)
  return { query: output.query, hits: output.hits.map(toStoryRagHit) }
}

export async function panoramaStoryRag(projectSlug: string, query: string): Promise<PanoramaSearchOutput> {
  const output = await fetchJson<BackendPanoramaSearchOutput>(`/api/projects/${encodeURIComponent(projectSlug)}/rag/panorama?query=${encodeURIComponent(query)}`)
  return { query: output.query, activeFacts: output.active_facts.map(toStoryRagHit), historicalFacts: output.historical_facts.map(toStoryRagHit), nodes: output.nodes.map(toStoryGraphNode), edges: output.edges.map(toStoryGraphEdge) }
}

export async function insightForge(projectSlug: string, query: string): Promise<InsightForgeOutput> {
  const output = await fetchJson<BackendInsightForgeOutput>(`/api/projects/${encodeURIComponent(projectSlug)}/rag/insight?query=${encodeURIComponent(query)}`)
  return { query: output.query, subQueries: output.sub_queries, facts: output.facts.map(toStoryRagHit), relationshipChains: output.relationship_chains, riskNotes: output.risk_notes }
}

function toSwarmTurnRecord(record: BackendSwarmTurnRecord): SwarmTurnRecord {
  return {
    sessionId: record.session_id,
    round: record.round,
    timepointId: record.timepoint_id,
    contexts: record.contexts.map((context) => ({
      agentId: context.agent_id,
      role: context.role,
      intent: context.intent,
      reasoningSummary: context.reasoning_summary,
      evidence: context.evidence,
      consistencyChecks: context.consistency_checks,
      ragHits: context.rag_hits.map(toStoryRagHit),
    })),
    outputs: record.outputs.map((output) => ({
      agentId: output.agent_id,
      role: output.role,
      intent: output.intent,
      reasoningSummary: output.reasoning_summary,
      evidence: output.evidence,
      actions: output.actions,
      consistencyChecks: output.consistency_checks,
    })),
  }
}

export async function getSwarmRound(projectSlug: string, sessionId: string, round: number): Promise<SwarmTurnRecord | undefined> {
  const record = await fetchJson<BackendSwarmTurnRecord | null>(`/api/projects/${encodeURIComponent(projectSlug)}/simulation/sessions/${encodeURIComponent(sessionId)}/swarm/${round}`)
  return record ? toSwarmTurnRecord(record) : undefined
}

function toReportRecord(record: BackendReportRecord): ReportRecord {
  return { id: record.id, kind: record.kind, title: record.title, path: record.path, body: record.body }
}

export async function createSimulationReport(projectSlug: string, payload: { sessionId: string; round: number; query?: string }): Promise<ReportRecord> {
  const report = await fetchJson<BackendReportRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/reports/simulation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: payload.sessionId, round: payload.round, query: payload.query }),
  })
  return toReportRecord(report)
}

export async function listReports(projectSlug: string): Promise<ReportSummary[]> {
  return fetchJson<BackendReportSummary[]>(`/api/projects/${encodeURIComponent(projectSlug)}/reports`)
}

export async function getReport(projectSlug: string, kind: ReportKind, id: string): Promise<ReportRecord> {
  const report = await fetchJson<BackendReportRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/reports/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`)
  return toReportRecord(report)
}

function toInterviewRecord(record: BackendInterviewRecord): InterviewRecord {
  return { id: record.id, sessionId: record.session_id, path: record.path, body: record.body }
}

export async function createInterview(projectSlug: string, sessionId: string, payload: { agentIds: string[]; questions: string[] }): Promise<InterviewRecord> {
  const interview = await fetchJson<BackendInterviewRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/simulation/sessions/${encodeURIComponent(sessionId)}/interview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_ids: payload.agentIds, questions: payload.questions }),
  })
  return toInterviewRecord(interview)
}

export async function createConsistencyReport(projectSlug: string, payload: { sessionId: string; round: number }): Promise<ReportRecord> {
  const report = await fetchJson<BackendReportRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/reports/consistency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: payload.sessionId, round: payload.round }),
  })
  return toReportRecord(report)
}

export async function createBranchImpactReport(projectSlug: string, payload: { branchId: string; query?: string }): Promise<ReportRecord> {
  const report = await fetchJson<BackendReportRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/reports/branch-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch_id: payload.branchId, query: payload.query }),
  })
  return toReportRecord(report)
}

export async function createWritingPrewriteReport(projectSlug: string, payload: { chapterId: string; query?: string }): Promise<ReportRecord> {
  const report = await fetchJson<BackendReportRecord>(`/api/projects/${encodeURIComponent(projectSlug)}/reports/writing-prewrite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter_id: payload.chapterId, query: payload.query }),
  })
  return toReportRecord(report)
}

export function formatSwarmActionLabel(action: SwarmOutputAction): string {
  switch (action.type) {
    case 'append_audit':
      return `append_audit -> ${action.path ?? ''}`
    case 'append_memory':
      return `append_memory -> ${action.path ?? ''}`
    case 'append_project_text':
      return `append_project_text -> ${action.path ?? ''}`
    case 'replace_project_section':
      return `replace_section -> ${action.path ?? ''}${action.old ? ` [${action.old.trim()}]` : ''}`
    case 'append_project_section':
      return `append_section -> ${action.path ?? ''}${action.marker ? ` [${action.marker.trim()}]` : ''}`
    default:
      return `${action.type}${action.path ? ` -> ${action.path}` : ''}`
  }
}
