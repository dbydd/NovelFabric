import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsView from './SettingsView.vue'

const ensureProject = vi.fn()
const importNovelText = vi.fn()
const getLlmEndpoint = vi.fn()
const getLlmRole = vi.fn()
const listLlmRoles = vi.fn()
const saveLlmEndpoint = vi.fn()
const saveLlmRole = vi.fn()
const deleteCard = vi.fn()
const saveAgentSkill = vi.fn()
const deleteAgentSkill = vi.fn()
const route = { params: { slug: 'alpha-project' } }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

vi.mock('../lib/workspace', () => ({
  ensureProject: (...args: unknown[]) => ensureProject(...args),
  importNovelText: (...args: unknown[]) => importNovelText(...args),
  getLlmEndpoint: (...args: unknown[]) => getLlmEndpoint(...args),
  getLlmRole: (...args: unknown[]) => getLlmRole(...args),
  listLlmRoles: (...args: unknown[]) => listLlmRoles(...args),
  saveLlmEndpoint: (...args: unknown[]) => saveLlmEndpoint(...args),
  saveLlmRole: (...args: unknown[]) => saveLlmRole(...args),
  deleteCard: (...args: unknown[]) => deleteCard(...args),
  saveAgentSkill: (...args: unknown[]) => saveAgentSkill(...args),
  deleteAgentSkill: (...args: unknown[]) => deleteAgentSkill(...args),
  saveCard: vi.fn(),
  updateAgent: vi.fn(),
  getAgent: vi.fn(),
  updateProject: vi.fn(),
}))

describe('SettingsView', () => {
  beforeEach(() => {
    ensureProject.mockReset()
    importNovelText.mockReset()
    getLlmEndpoint.mockReset()
    getLlmRole.mockReset()
    listLlmRoles.mockReset()
    saveLlmEndpoint.mockReset()
    saveLlmRole.mockReset()
    getLlmEndpoint.mockResolvedValue(undefined)
    getLlmRole.mockResolvedValue(undefined)
    listLlmRoles.mockResolvedValue([])
    saveLlmEndpoint.mockImplementation(async (endpoint) => endpoint)
    saveLlmRole.mockImplementation(async (role) => role)
  })

  it('renders imported report after file import', async () => {
    ensureProject.mockResolvedValue({
      slug: 'alpha-project',
      title: 'Alpha',
      description: 'Desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [{ id: 'c1', kind: 'character', title: '角色卡', body: 'body' }],
      memory: [],
      chapters: [],
      simulation: { sessionId: 'session-main', round: 0, possessedCharacterId: '', logs: [] },
      branches: [],
    })
    importNovelText.mockResolvedValue({
      slug: 'alpha-project',
      title: 'Alpha',
      description: 'Desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [{ id: 'c1', kind: 'character', title: '角色卡', body: 'body' }],
      memory: [],
      chapters: [],
      simulation: { sessionId: 'session-main', round: 0, possessedCharacterId: '', logs: [] },
      branches: [],
      importReport: { sourceName: 'test_novel.txt', chapterCount: 2, importedAt: 'now', preview: 'preview' },
    })

    const wrapper = mount(SettingsView)
    await flushPromises()

    const file = new File(['第一章\n正文'], 'test_novel.txt', { type: 'text/plain' })
    const input = wrapper.get('[data-testid="novel-file-input"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('已导入 test_novel.txt，拆分 2 个章节。')
    expect(wrapper.text()).toContain('Import Report')
    expect(wrapper.text()).toContain('Simulation 页 tuning entrypoint 指向的主要编辑区：先选 Agent，优先检查 skills，再按需要回看 soul / memory。')
    expect(wrapper.text()).toContain('Priority: skills first. If target / mode still feels wrong, then review soul and memory.')

    await wrapper.get('[data-testid="llm-provider-input"]').setValue('pi-agent-compatible')
    await wrapper.get('[data-testid="llm-base-url-input"]').setValue('http://localhost:3000/v1')
    await wrapper.get('[data-testid="llm-api-key-input"]').setValue('browser-acceptance-key')
    await wrapper.get('[data-testid="save-llm-endpoint-button"]').trigger('click')
    await flushPromises()
    expect(saveLlmEndpoint).toHaveBeenCalledWith({ provider: 'pi-agent-compatible', base_url: 'http://localhost:3000/v1', api_key: 'browser-acceptance-key', api_style: 'OpenAiChatCompletions' })

    await wrapper.get('[data-testid="llm-model-input"]').setValue('generic-writer')
    await wrapper.get('[data-testid="save-llm-button"]').trigger('click')
    await flushPromises()
    expect(saveLlmRole).toHaveBeenCalledWith({ role_id: 'default', model: 'generic-writer', api_style: null })

    await wrapper.get('[data-testid="llm-role-id-input"]').setValue('ye-xiao-wei')
    await wrapper.get('[data-testid="llm-role-model-input"]').setValue('generic-vibe')
    await wrapper.get('[data-testid="save-role-llm-button"]').trigger('click')
    await flushPromises()
    expect(saveLlmRole).toHaveBeenCalledWith({ role_id: 'ye-xiao-wei', model: 'generic-vibe', api_style: null })
  })
})
