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
const testLlmHealth = vi.fn()
const getAgent = vi.fn()
const getAgentSkill = vi.fn()
const deleteCard = vi.fn()
const saveAgentSkill = vi.fn()
const deleteAgentSkill = vi.fn()
const route = { params: { slug: 'alpha-project' } }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function projectFixture(overrides = {}) {
  return {
    slug: 'alpha-project',
    title: 'Alpha',
    description: 'Desc',
    createdAt: '2026-01-01T00:00:00.000Z',
    cards: [{ id: 'c1', kind: 'character', title: '角色卡', body: 'body' }],
    memory: [],
    chapters: [],
    simulation: { sessionId: 'session-main', round: 0, possessedCharacterId: '', logs: [] },
    branches: [],
    ...overrides,
  }
}

vi.mock('../lib/workspace', () => ({
  ensureProject: (...args: unknown[]) => ensureProject(...args),
  importNovelText: (...args: unknown[]) => importNovelText(...args),
  getLlmEndpoint: (...args: unknown[]) => getLlmEndpoint(...args),
  getLlmRole: (...args: unknown[]) => getLlmRole(...args),
  listLlmRoles: (...args: unknown[]) => listLlmRoles(...args),
  saveLlmEndpoint: (...args: unknown[]) => saveLlmEndpoint(...args),
  saveLlmRole: (...args: unknown[]) => saveLlmRole(...args),
  testLlmHealth: (...args: unknown[]) => testLlmHealth(...args),
  deleteCard: (...args: unknown[]) => deleteCard(...args),
  saveAgentSkill: (...args: unknown[]) => saveAgentSkill(...args),
  deleteAgentSkill: (...args: unknown[]) => deleteAgentSkill(...args),
  saveCard: vi.fn(),
  updateAgent: vi.fn(),
  getAgent: (...args: unknown[]) => getAgent(...args),
  getAgentSkill: (...args: unknown[]) => getAgentSkill(...args),
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
    testLlmHealth.mockReset()
    getAgent.mockReset()
    getAgentSkill.mockReset()
    getLlmEndpoint.mockResolvedValue(undefined)
    getLlmRole.mockResolvedValue(undefined)
    listLlmRoles.mockResolvedValue([])
    saveLlmEndpoint.mockImplementation(async (endpoint) => endpoint)
    saveLlmRole.mockImplementation(async (role) => role)
    testLlmHealth.mockResolvedValue({ ok: true, role_id: 'default', provider: 'pi-agent-compatible', model: 'generic-writer', api_style: 'OpenAiChatCompletions', latency_ms: 12, response_preview: 'NovelFabric LLM healthcheck OK' })
    getAgent.mockResolvedValue({ agentId: 'ye-xiao-wei', soulTitle: '叶小伟', skillCount: 1, soul: '# 叶小伟', memory: '# Memory', skills: ['character-decision.md'] })
    getAgentSkill.mockResolvedValue({ agentId: 'ye-xiao-wei', fileName: 'character-decision.md', body: '---\nintent: character-decision\ntarget: simulation/logs\nmode: append\n---\n# character-decision\n' })
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
      importReport: {
        sourceName: 'test_novel.txt',
        chapterCount: 2,
        importedAt: 'now',
        preview: 'LLM semantic extraction: llm_succeeded; LLM semantic extraction succeeded with 3 card(s).; model=generic-writer; cards=3; memory=2; timepoints=2; report=test-novel.md',
        extractionStatus: 'llm_succeeded',
        extractionMessage: 'LLM semantic extraction succeeded with 3 card(s).',
        llmModel: 'generic-writer',
      },
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
    expect(wrapper.get('[data-testid="import-extraction-status"]').text()).toContain('LLM semantic extraction: llm_succeeded')
    expect(wrapper.get('[data-testid="import-extraction-message"]').text()).toContain('LLM semantic extraction succeeded')
    expect(wrapper.get('[data-testid="import-llm-model"]').text()).toContain('generic-writer')
    expect(wrapper.text()).toContain('Simulation 页 tuning entrypoint 指向的主要编辑区：先选 Agent，优先检查 skills，再按需要回看 soul / memory。')
    expect(wrapper.text()).toContain('Priority: skills first. If target / mode still feels wrong, then review soul and memory.')

    await wrapper.get('[data-testid="llm-provider-input"]').setValue('pi-agent-compatible')
    await wrapper.get('[data-testid="llm-base-url-input"]').setValue('https://provider.invalid/v1')
    await wrapper.get('[data-testid="llm-api-key-input"]').setValue('browser-acceptance-key')
    await wrapper.get('[data-testid="save-llm-endpoint-button"]').trigger('click')
    await flushPromises()
    expect(saveLlmEndpoint).toHaveBeenCalledWith({ provider: 'pi-agent-compatible', base_url: 'https://provider.invalid/v1', api_key: 'browser-acceptance-key', api_style: 'OpenAiChatCompletions' })

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

  it('shows loading success and healthcheck feedback for llm settings mutations', async () => {
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
      agents: [{ agentId: 'ye-xiao-wei', soulTitle: '叶小伟', skillCount: 1 }],
    })

    const wrapper = mount(SettingsView)
    await flushPromises()

    expect((wrapper.get('[data-testid="llm-provider-input"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[data-testid="llm-base-url-input"]').element as HTMLInputElement).value).toBe('')

    await wrapper.get('[data-testid="llm-provider-input"]').setValue('pi-agent-compatible')
    await wrapper.get('[data-testid="llm-model-input"]').setValue('generic-writer')
    await wrapper.get('[data-testid="save-llm-endpoint-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('已保存 Endpoint / Key')

    await wrapper.get('[data-testid="save-llm-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('已保存默认模型')

    await wrapper.get('[data-testid="test-llm-button"]').trigger('click')
    await flushPromises()
    expect(testLlmHealth).toHaveBeenCalledWith({ role_id: 'default' })
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('LLM 可用')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('Role: default')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('generic-writer')
  })

  it('shows provider error kind and status when llm healthcheck fails', async () => {
    ensureProject.mockResolvedValue({
      slug: 'alpha-project',
      title: 'Alpha',
      description: 'Desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [],
      memory: [],
      chapters: [],
      simulation: { sessionId: 'session-main', round: 0, possessedCharacterId: '', logs: [] },
      branches: [],
    })
    testLlmHealth.mockResolvedValue({ ok: false, role_id: 'default', provider: 'local-error-provider', model: 'auth-failure-writer', api_style: 'OpenAiChatCompletions', latency_ms: 9, provider_status: 401, error_kind: 'auth', error_message: 'local provider rejected the API key' })

    const wrapper = mount(SettingsView)
    await flushPromises()
    await wrapper.get('[data-testid="test-llm-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('LLM 测试失败')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('LLM 不可用')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('Provider status: 401')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('auth')
  })

  it('runs role-specific healthcheck and shows the resolved override result', async () => {
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
      agents: [{ agentId: 'kp', soulTitle: 'KP', skillCount: 1 }],
    })
    listLlmRoles.mockResolvedValue([{ role_id: 'kp', model: 'role-specialist', api_style: 'AnthropicMessages' }])
    testLlmHealth.mockResolvedValue({ ok: true, role_id: 'kp', provider: 'pi-agent-compatible', model: 'role-specialist', api_style: 'AnthropicMessages', latency_ms: 8, response_preview: 'role ok' })

    const wrapper = mount(SettingsView)
    await flushPromises()

    await wrapper.get('[data-testid="llm-role-pick-button"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('[data-testid="llm-role-id-input"]').element as HTMLInputElement).value).toBe('kp')
    expect((wrapper.get('[data-testid="llm-role-model-input"]').element as HTMLInputElement).value).toBe('role-specialist')
    expect((wrapper.get('[data-testid="llm-role-style-select"]').element as HTMLSelectElement).value).toBe('AnthropicMessages')

    await wrapper.get('[data-testid="test-role-llm-button"]').trigger('click')
    await flushPromises()

    expect(testLlmHealth).toHaveBeenCalledWith({ role_id: 'kp' })
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('角色 kp LLM 测试完成')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('Role: kp')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('role-specialist')
    expect(wrapper.get('[data-testid="llm-health-result"]').text()).toContain('AnthropicMessages')
  })

  it('shows visible error feedback when llm settings save fails', async () => {
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
    saveLlmEndpoint.mockRejectedValue(new Error('provider rejected request: 401 invalid key'))

    const wrapper = mount(SettingsView)
    await flushPromises()

    await wrapper.get('[data-testid="save-llm-endpoint-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('保存 Endpoint / Key 失败')
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('invalid key')
  })

  it('loads an existing skill body into the editor and saves edits to the same file', async () => {
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
      agents: [{ agentId: 'ye-xiao-wei', soulTitle: '叶小伟', skillCount: 1 }],
    })
    saveAgentSkill.mockImplementation(async (_slug, _agentId, _fileName, _body) => ({ agentId: 'ye-xiao-wei', soulTitle: '叶小伟', skillCount: 1, soul: '# 叶小伟', memory: '# Memory', skills: ['character-decision.md'] }))

    const wrapper = mount(SettingsView)
    await flushPromises()

    expect(getAgentSkill).toHaveBeenCalledWith('alpha-project', 'ye-xiao-wei', 'character-decision.md')
    expect((wrapper.get('[data-testid="skill-file-input"]').element as HTMLInputElement).value).toBe('character-decision.md')
    expect((wrapper.get('[data-testid="skill-body-input"]').element as HTMLTextAreaElement).value).toContain('target: simulation/logs')

    await wrapper.get('[data-testid="skill-body-input"]').setValue('---\nintent: character-decision\ntarget: memory\nmode: append\n---\n# edited skill\n')
    await wrapper.get('[data-testid="save-skill-button"]').trigger('click')
    await flushPromises()

    expect(saveAgentSkill).toHaveBeenCalledWith('alpha-project', 'ye-xiao-wei', 'character-decision.md', expect.stringContaining('# edited skill'))
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('已保存 skill：character-decision.md')
  })

  it('keeps buttons disabled and shows in-progress status while saving endpoint', async () => {
    ensureProject.mockResolvedValue(projectFixture())
    const pending = deferred<unknown>()
    saveLlmEndpoint.mockReturnValue(pending.promise)

    const wrapper = mount(SettingsView)
    await flushPromises()

    await wrapper.get('[data-testid="save-llm-endpoint-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('正在保存 Endpoint / Key')
    expect((wrapper.get('[data-testid="save-llm-button"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get('[data-testid="test-llm-button"]').element as HTMLButtonElement).disabled).toBe(true)

    pending.resolve({ provider: 'pi-agent-compatible', base_url: 'https://provider.invalid/v1', api_key: 'key', api_style: 'OpenAiChatCompletions' })
    await flushPromises()
    expect(wrapper.get('[data-testid="llm-config-status"]').text()).toContain('已保存 Endpoint / Key')
    expect((wrapper.get('[data-testid="save-llm-button"]').element as HTMLButtonElement).disabled).toBe(false)
  })
})
