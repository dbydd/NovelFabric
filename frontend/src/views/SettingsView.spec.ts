import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsView from './SettingsView.vue'

const ensureProject = vi.fn()
const importNovelText = vi.fn()
const route = { params: { slug: 'alpha-project' } }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

vi.mock('../lib/workspace', () => ({
  ensureProject: (...args: unknown[]) => ensureProject(...args),
  importNovelText: (...args: unknown[]) => importNovelText(...args),
  updateProject: vi.fn(),
}))

describe('SettingsView', () => {
  beforeEach(() => {
    ensureProject.mockReset()
    importNovelText.mockReset()
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
  })
})
