import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createProject,
  ensureProject,
  getProject,
  importNovelText,
  loadProjects,
  saveProjects,
  slugify,
  syncProjectsFromBackend,
  type NovelProject,
} from './workspace'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('workspace library', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let storage: Storage

  beforeEach(() => {
    storage = createStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', fetchMock)
    storage.clear()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('slugify enforces backend-compatible ASCII slugs', () => {
    expect(slugify('Final Acceptance Project')).toBe('final-acceptance-project')
    expect(slugify('最终验收项目')).toMatch(/^project-/)
    expect(slugify(' Mixed__Value 123 ')).toBe('mixed-value-123')
  })

  it('createProject persists locally even when backend create fails', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 400 }))

    const project = await createProject('最终验收项目', 'fallback local persistence')

    expect(project.slug).toMatch(/^project-/)
    expect(loadProjects()).toHaveLength(1)
    expect(getProject(project.slug)?.title).toBe('最终验收项目')
  })

  it('syncProjectsFromBackend merges remote metadata with local workspace state', async () => {
    const localProject = {
      slug: 'alpha-project',
      title: 'Alpha Project',
      description: 'local state',
      createdAt: '2026-05-13T00:00:00.000Z',
      cards: [{ id: 'world-origin', kind: 'world', title: '世界观设定卡', body: 'body' }],
      memory: [],
      chapters: [],
      simulation: { sessionId: 'session-main', round: 2, possessedCharacterId: '', logs: [] },
      branches: [],
    } satisfies NovelProject
    saveProjects([localProject])

    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/projects')) {
        return new Response(JSON.stringify([
          { slug: 'alpha-project', title: 'Alpha Project', description: 'remote metadata' },
          { slug: 'beta-project', title: 'Beta Project', description: 'new remote project' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/projects/alpha-project')) {
        return new Response(JSON.stringify({ slug: 'alpha-project', title: 'Alpha Project', description: 'remote metadata' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/projects/beta-project')) {
        return new Response(JSON.stringify({ slug: 'beta-project', title: 'Beta Project', description: 'new remote project' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const merged = await syncProjectsFromBackend()

    expect(merged).toHaveLength(2)
    expect(merged.find((project) => project.slug === 'alpha-project')?.simulation.round).toBe(2)
    expect(merged.find((project) => project.slug === 'beta-project')?.cards.length).toBeGreaterThanOrEqual(0)
  })

  it('ensureProject falls back to backend sync when local storage misses a slug', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/projects/gamma-project')) {
        return new Response(JSON.stringify({ slug: 'gamma-project', title: 'Gamma Project', description: 'remote only' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/projects')) {
        return new Response(JSON.stringify([{ slug: 'gamma-project', title: 'Gamma Project', description: 'remote only' }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const project = await ensureProject('gamma-project')

    expect(project?.slug).toBe('gamma-project')
    expect(loadProjects()).toHaveLength(1)
  })

  it('importNovelText creates import report, chapters, memory, and cards', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const base = await createProject('Import Project', 'for import tests')
    const updated = await importNovelText(
      base,
      'test_novel.txt',
      '第一章 雾原\n剧情开始。\n\n第二章 北境\n剧情继续。',
    )

    expect(updated.importReport?.sourceName).toBe('test_novel.txt')
    expect(updated.importReport?.chapterCount).toBe(2)
    expect(updated.chapters.some((chapter) => chapter.id === 'import-001')).toBe(true)
    expect(updated.memory.some((entry) => entry.scope === 'chapter')).toBe(true)
    expect(updated.cards.some((card) => card.title.includes('导入概览'))).toBe(true)
  })
})
