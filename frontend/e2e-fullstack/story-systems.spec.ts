import { expect, test } from '@playwright/test'

const apiBase = process.env.PLAYWRIGHT_API_BASE ?? 'http://127.0.0.1:50003'

// API-assisted setup/verification coverage: this spec seeds story-system fixtures and
// checks persisted report artifacts through backend requests, while still exercising
// the user-visible Knowledge, Simulation, and Reports pages in the browser. Do not
// count this spec as browser-only acceptance evidence.
test('API-assisted full-stack story systems flow persists knowledge swarm report and interview artifacts', async ({ page, request }) => {
  const slug = `fullstack-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('Full-stack StoryGraph StorySwarm ReportAgent acceptance')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await request.post(`${apiBase}/api/projects/${slug}/cards`, {
    data: { kind: 'character', id: 'aria', title: 'Aria', body: 'Aria protects the vault and respects KP rulings.' },
  })
  await request.post(`${apiBase}/api/projects/${slug}/writing/chapters`, {
    data: { id: 'chapter-001', title: 'Chapter 1', body: 'Aria enters the vault and hears an oath.' },
  })
  await request.post(`${apiBase}/api/projects/${slug}/timeline/timepoints`, { data: { id: 'tp-origin', sequence: 1, title: 'Origin', summary: 'Origin timepoint', branch_id: null } })
  await request.post(`${apiBase}/api/projects/${slug}/timeline/branches`, { data: { id: 'branch-a', title: 'Branch A', description: 'branch desc', origin_timepoint_id: 'tp-origin' } })
  await request.post(`${apiBase}/api/projects/${slug}/simulation/sessions`, {
    data: {
      session_id: 'session-main',
      timeline: 'main',
      timepoint_id: 'tp-0001',
      title: 'Vault Session',
      characters: [{ character_id: 'aria', display_name: 'Aria', agenda: 'Protect the vault' }],
    },
  })

  await page.goto(`/novelfabric/project/${slug}/knowledge`)
  await page.getByTestId('rag-query-input').fill('Aria')
  await page.getByTestId('rebuild-knowledge-button').click()
  await expect(page.getByTestId('knowledge-stats')).toContainText('Nodes')
  await expect(page.getByTestId('graph-node')).toContainText(/aria/i)
  await expect(page.getByTestId('graph-node')).toContainText('Character')

  await page.goto(`/novelfabric/project/${slug}/simulation`)
  await page.getByTestId('advance-round-button').click()
  await expect(page.getByTestId('swarm-round-panel')).toContainText('StorySwarm 审计')
  await expect(page.getByTestId('runtime-plan-panel')).toContainText('Planned Runtime Actions')
  await expect(page.getByTestId('runtime-plan-panel')).toContainText('append_audit')
  await expect(page.getByTestId('runtime-plan-panel')).toContainText('history/project-audit-log.md')
  await expect(page.getByTestId('system-updates-panel')).toContainText('Observed File Updates')
  await expect(page.getByTestId('system-updates-panel')).toContainText('history/project-audit-log.md')
  await expect(page.getByTestId('system-updates-panel')).toContainText('project-auditor · project_audit')
  await expect(page.getByTestId('system-updates-panel')).toContainText('append_project_section')
  await expect(page.getByTestId('system-updates-panel')).toContainText('planner decision explanation')
  await expect(page.getByTestId('system-updates-panel')).toContainText('target selected by')
  await expect(page.getByTestId('system-updates-panel')).toContainText('because:')
  await expect(page.getByTestId('system-updates-panel')).toContainText('tuning entrypoint for project-auditor')
  await expect(page.getByTestId('system-updates-panel')).toContainText('step 1: go to 项目设定 → Agent 资产')
  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('settings-view')).toContainText('Simulation 页 tuning entrypoint 指向的主要编辑区：先选 Agent，优先检查 skills，再按需要回看 soul / memory。')
  await expect(page.getByTestId('settings-view')).toContainText('Priority: skills first. If target / mode still feels wrong, then review soul and memory.')

  const swarmResponse = await request.get(`${apiBase}/api/projects/${slug}/simulation/sessions/session-main/swarm/1`)
  expect(swarmResponse.ok()).toBe(true)
  const swarm = await swarmResponse.json()
  expect(swarm.contexts.length).toBeGreaterThan(0)

  await page.goto(`/novelfabric/project/${slug}/reports`)
  await page.getByTestId('report-query-input').fill('Aria')
  await page.getByTestId('generate-report-button').click()
  await expect(page.getByTestId('report-system-role-hint')).toContainText('本报告已纳入系统角色落盘结果摘要')
  await expect(page.getByTestId('report-kind-hint')).toContainText('该推演报告综合了 StoryRAG、StorySwarm 与系统角色落盘结果。')
  await expect(page.getByTestId('report-body')).toContainText('## 系统角色落盘结果')
  await expect(page.getByTestId('report-body')).toContainText('project-audit-log.md')
  await expect(page.getByTestId('report-body')).toContainText('## 引用')
  await page.getByTestId('generate-consistency-report-button').click()
  await expect(page.getByTestId('report-body')).toContainText('一致性审计报告')
  await expect(page.getByTestId('report-kind-hint')).toContainText('该一致性审计报告会优先强调 StorySwarm 检查结果与系统角色落盘摘要。')
  await page.getByTestId('branch-id-input').fill('branch-a')
  await page.getByTestId('generate-branch-impact-button').click()
  await expect(page.getByTestId('report-body')).toContainText('分支影响分析')
  await expect(page.getByTestId('report-kind-hint')).toContainText('该分支影响分析会结合 branch 元数据、StoryRAG 事实和系统角色落盘结果。')
  await page.getByTestId('chapter-id-input').fill('chapter-001')
  await page.getByTestId('generate-prewrite-report-button').click()
  await expect(page.getByTestId('report-body')).toContainText('续写预备报告')
  await expect(page.getByTestId('report-kind-hint')).toContainText('该续写预备报告会结合章节文本、StoryRAG 事实和系统角色落盘结果。')

  await page.getByTestId('interview-agents-input').fill('aria,kp')
  await page.getByTestId('interview-question-input').fill('你为什么这样行动？')
  await page.getByTestId('run-interview-button').click()
  await expect(page.getByTestId('interview-body')).toContainText('# Interview Record')

  const reportsResponse = await request.get(`${apiBase}/api/projects/${slug}/reports`)
  expect(reportsResponse.ok()).toBe(true)
  const reports = await reportsResponse.json()
  expect(reports.some((report: { path: string }) => report.path.includes('reports/simulation'))).toBe(true)
  expect(reports.some((report: { path: string }) => report.path.includes('reports/consistency'))).toBe(true)
  expect(reports.some((report: { path: string }) => report.path.includes('reports/branch-impact'))).toBe(true)
  expect(reports.some((report: { path: string }) => report.path.includes('reports/writing'))).toBe(true)
})
