import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WritingView from './WritingView.vue'

const ensureProject = vi.fn()
const updateProject = vi.fn()
const route = { params: { slug: 'alpha-project' } }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

vi.mock('../lib/workspace', () => ({
  ensureProject: (...args: unknown[]) => ensureProject(...args),
  updateProject: (...args: unknown[]) => updateProject(...args),
}))

describe('WritingView', () => {
  beforeEach(() => {
    ensureProject.mockReset()
    updateProject.mockReset()
  })

  it('shows branch controls when a historical chapter is selected', async () => {
    ensureProject.mockResolvedValue({
      slug: 'alpha-project',
      title: 'Alpha',
      description: 'Desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [],
      memory: [],
      chapters: [
        { id: 'import-001', title: '历史章节', body: 'old', isCurrent: false },
        { id: 'chapter-001', title: '当前章节', body: 'current', isCurrent: true },
      ],
      simulation: { sessionId: 'session-main', round: 0, possessedCharacterId: '', logs: [] },
      branches: [],
    })

    const wrapper = mount(WritingView)
    await flushPromises()

    const chapterButtons = wrapper.findAll('[data-testid="chapter-item"]')
    expect(chapterButtons).toHaveLength(2)
    await chapterButtons[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="branch-box"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('历史章节不可直接修改')
  })
})
