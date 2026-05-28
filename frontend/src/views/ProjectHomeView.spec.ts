import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectHomeView from './ProjectHomeView.vue'

const push = vi.fn()
const createProjectMock = vi.fn<(title: string, description: string) => Promise<{ slug: string; title: string; description: string }>>(async () => ({ slug: 'alpha-project', title: 'Alpha Project', description: 'desc' }))
const syncProjectsMock = vi.fn(async () => [] as Array<{ slug: string; title: string; description: string; cards?: unknown[]; memory?: unknown[]; chapters?: unknown[] }>)

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('../lib/workspace', () => ({
  createProject: (title: string, description: string) => createProjectMock(title, description),
  loadProjects: vi.fn(() => []),
  syncProjectsFromBackend: () => syncProjectsMock(),
}))

describe('ProjectHomeView', () => {
  beforeEach(() => {
    push.mockReset()
    createProjectMock.mockReset()
    createProjectMock.mockResolvedValue({ slug: 'alpha-project', title: 'Alpha Project', description: 'desc' })
    syncProjectsMock.mockReset()
    syncProjectsMock.mockResolvedValue([])
  })


  it('shows backend project-list load errors instead of silently using local cache', async () => {
    syncProjectsMock.mockRejectedValue(new Error('request failed: 500 /api/projects'))
    const wrapper = mount(ProjectHomeView)
    await flushPromises()

    expect(wrapper.get('[data-testid="create-project-status"]').text()).toContain('读取后端项目失败：request failed: 500 /api/projects')
  })

  it('shows backend creation errors instead of routing to a local-only project', async () => {
    createProjectMock.mockRejectedValue(new Error('request failed: 500 /api/projects: backend unavailable'))
    const wrapper = mount(ProjectHomeView)

    await wrapper.get('[data-testid="project-title-input"]').setValue('Broken Project')
    await wrapper.get('[data-testid="create-project-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="create-project-status"]').text()).toContain('创建失败：request failed: 500 /api/projects')
    expect(push).not.toHaveBeenCalled()
  })

  it('submits project creation and routes to settings', async () => {
    const wrapper = mount(ProjectHomeView)

    await wrapper.get('[data-testid="project-title-input"]').setValue('Alpha Project')
    await wrapper.get('[data-testid="project-description-input"]').setValue('desc')
    await wrapper.get('[data-testid="create-project-form"]').trigger('submit')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/project/alpha-project/settings')
  })
})
