import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectHomeView from './ProjectHomeView.vue'

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('../lib/workspace', () => ({
  createProject: vi.fn(async () => ({ slug: 'alpha-project', title: 'Alpha Project', description: 'desc' })),
  loadProjects: vi.fn(() => []),
  syncProjectsFromBackend: vi.fn(async () => []),
}))

describe('ProjectHomeView', () => {
  beforeEach(() => {
    push.mockReset()
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
