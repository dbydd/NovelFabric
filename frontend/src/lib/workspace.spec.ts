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

  it('createProject reports backend failure instead of creating local-only projects', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 400 }))

    await expect(createProject('最终验收项目', 'backend-required persistence')).rejects.toThrow('request failed: 400 /api/projects')
    expect(loadProjects()).toHaveLength(0)
  })

  it('syncProjectsFromBackend hydrates remote metadata without inventing local-only projects', async () => {
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

  it('ensureProject hydrates backend state when local storage misses a slug', async () => {
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

  it('uploads the original File blob so non-UTF8 novels reach backend decoder intact', async () => {
    const base = {
      slug: 'gbk-project',
      title: 'GBK Project',
      description: 'preserve bytes',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [],
      memory: [],
      chapters: [],
      simulation: { sessionId: '', round: 0, possessedCharacterId: '', logs: [] },
      branches: [],
    } satisfies NovelProject
    saveProjects([base])
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/projects/gbk-project/import')) {
        expect(init?.body).toBeInstanceOf(FormData)
        const form = init?.body as FormData
        const uploaded = form.get('file') as File
        expect(uploaded).toBeInstanceOf(File)
        expect(uploaded.name).toBe('test_novel.txt')
        expect(uploaded.type).toBe('text/plain')
        return new Response(JSON.stringify({
          source_name: 'test_novel.txt',
          chapter_count: 10,
          report_file: 'test-novel.md',
          card_ids: ['ye-xiao-wei'],
          memory_keys: ['import-test-novel-summary'],
          timepoint_ids: ['tp-001'],
          extraction_status: 'llm_succeeded',
          extraction_message: 'LLM semantic extraction succeeded with 3 card(s).',
          llm_model: 'generic-writer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/projects/gbk-project')) {
        return new Response(JSON.stringify({ slug: 'gbk-project', title: 'GBK Project', description: 'preserve bytes' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const file = new File([new Uint8Array([0xb5, 0xda, 0x31, 0xd5, 0xc2])], 'test_novel.txt', { type: 'text/plain' })
    const updated = await importNovelText(base, 'test_novel.txt', file)

    expect(updated.importReport?.chapterCount).toBe(10)
    expect(updated.importReport?.extractionStatus).toBe('llm_succeeded')
    expect(updated.importReport?.preview).toContain('LLM semantic extraction: llm_succeeded')
    expect(updated.importReport?.preview).toContain('generic-writer')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/projects/gbk-project/import'), expect.objectContaining({ method: 'POST' }))
  })


  it('syncProjectsFromBackend reports project-list failure instead of silently using local cache', async () => {
    saveProjects([{ ...({} as NovelProject), slug: 'stale-local', title: 'Stale Local', description: 'must not be returned as success', createdAt: '2026-01-01T00:00:00.000Z', cards: [], memory: [], chapters: [], simulation: { sessionId: '', round: 0, possessedCharacterId: '', logs: [] }, branches: [] }])
    fetchMock.mockResolvedValue(new Response('backend unavailable', { status: 500 }))

    await expect(syncProjectsFromBackend()).rejects.toThrow('request failed: 500 /api/projects')
    expect(loadProjects()).toHaveLength(1)
  })

})
