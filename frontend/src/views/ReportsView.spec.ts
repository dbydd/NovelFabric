import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ReportsView from './ReportsView.vue'

const ensureProject = vi.fn()
const listReports = vi.fn()
const createSimulationReport = vi.fn()
const createInterview = vi.fn()
const createConsistencyReport = vi.fn()
const createBranchImpactReport = vi.fn()
const createWritingPrewriteReport = vi.fn()
const getReport = vi.fn()
const route = { params: { slug: 'alpha-project' } }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

vi.mock('../lib/workspace', () => ({
  ensureProject: (...args: unknown[]) => ensureProject(...args),
  listReports: (...args: unknown[]) => listReports(...args),
  createSimulationReport: (...args: unknown[]) => createSimulationReport(...args),
  createInterview: (...args: unknown[]) => createInterview(...args),
  createConsistencyReport: (...args: unknown[]) => createConsistencyReport(...args),
  createBranchImpactReport: (...args: unknown[]) => createBranchImpactReport(...args),
  createWritingPrewriteReport: (...args: unknown[]) => createWritingPrewriteReport(...args),
  getReport: (...args: unknown[]) => getReport(...args),
}))

describe('ReportsView', () => {
  beforeEach(() => {
    ensureProject.mockReset()
    listReports.mockReset()
    createSimulationReport.mockReset()
    createInterview.mockReset()
    createConsistencyReport.mockReset()
    createBranchImpactReport.mockReset()
    createWritingPrewriteReport.mockReset()
    getReport.mockReset()
  })

  it('generates report and interview records from the report center', async () => {
    ensureProject.mockResolvedValue({
      slug: 'alpha-project',
      title: 'Alpha',
      description: 'Desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [],
      memory: [],
      chapters: [],
      simulation: { sessionId: 'session-main', round: 2, possessedCharacterId: '', logs: [] },
      branches: [],
    })
    listReports.mockResolvedValue([])
    createSimulationReport.mockResolvedValue({ id: 'session-main-round-0002', kind: 'simulation', title: 'Round report', path: 'reports/simulation/session-main-round-0002.md', body: '# 推演报告\n\n## 系统角色落盘结果\n- history/project-audit-log.md :: project audit note persisted' })
    createConsistencyReport.mockResolvedValue({ id: 'session-main-round-0002-consistency', kind: 'consistency', title: 'Consistency', path: 'reports/consistency/session-main-round-0002-consistency.md', body: '# 一致性审计报告' })
    createBranchImpactReport.mockResolvedValue({ id: 'branch-a-impact', kind: 'branch-impact', title: 'Branch impact', path: 'reports/branch-impact/branch-a-impact.md', body: '# 分支影响分析' })
    createWritingPrewriteReport.mockResolvedValue({ id: 'chapter-001-prewrite', kind: 'writing', title: 'Prewrite', path: 'reports/writing/chapter-001-prewrite.md', body: '# 续写预备报告' })
    createInterview.mockResolvedValue({ id: 'interview-round-0002', sessionId: 'session-main', path: 'simulation/sessions/session-main/interviews/interview-round-0002.md', body: '# Interview Record' })

    const wrapper = mount(ReportsView)
    await flushPromises()

    await wrapper.get('[data-testid="generate-report-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('# 推演报告')
    expect(wrapper.text()).toContain('本报告已纳入系统角色落盘结果摘要')
    expect(wrapper.text()).toContain('该推演报告综合了 StoryRAG、StorySwarm 与系统角色落盘结果。')

    await wrapper.get('[data-testid="generate-consistency-report-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('# 一致性审计报告')
    expect(wrapper.text()).toContain('该一致性审计报告会优先强调 StorySwarm 检查结果与系统角色落盘摘要。')

    await wrapper.get('[data-testid="branch-id-input"]').setValue('branch-a')
    await wrapper.get('[data-testid="generate-branch-impact-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('# 分支影响分析')
    expect(wrapper.text()).toContain('该分支影响分析会结合 branch 元数据、StoryRAG 事实和系统角色落盘结果。')

    await wrapper.get('[data-testid="chapter-id-input"]').setValue('chapter-001')
    await wrapper.get('[data-testid="generate-prewrite-report-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('# 续写预备报告')
    expect(wrapper.text()).toContain('该续写预备报告会结合章节文本、StoryRAG 事实和系统角色落盘结果。')

    await wrapper.get('[data-testid="interview-agents-input"]').setValue('kp,project-auditor')
    await wrapper.get('[data-testid="interview-question-input"]').setValue('你为什么这样行动？')
    await wrapper.get('[data-testid="run-interview-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('# Interview Record')
  })
})
