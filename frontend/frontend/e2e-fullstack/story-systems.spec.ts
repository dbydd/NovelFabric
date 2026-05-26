import { expect, test } from '@playwright/test'

const apiBase = 'http://127.0.0.1:50090'

test('full-stack story systems flow persists knowledge swarm report and interview artifacts', async ({ page, request }) => {
  const slug = `fullstack-${Date.now()}`

  await page.goto('/')
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
  await request.post(`${apiBase}/api/projects/${slug}/simulation/sessions`, {
    data: {
      session_id: 'session-main',
      timeline: 'main',
      timepoint_id: 'tp-0001',
      title: 'Vault Session',
      characters: [{ character_id: 'aria', display_name: 'Aria', agenda: 'Protect the vault' }],
    },
  })

  await page.goto(`/project/${slug}/knowledge`)
  await expect(page.getByTestId('knowledge-view')).toBeVisible()
  await page.getByTestId('rag-query-input').fill('Aria')
  await page.getByTestId('rebuild-knowledge-button').click()
  await expect(page.getByTestId('knowledge-stats')).toContainText('Nodes')
  await expect(page.getByTestId('graph-node')).toContainText('Aria')

  await page.goto(`/project/${slug}/simulation`)
  await expect(page.getByTestId('simulation-view')).toBeVisible()
  await page.getByTestId('advance-round-button').click()
  await expect(page.getByTestId('swarm-round-panel')).toContainText('StorySwarm 审计')

  const swarmResponse = await request.get(`${apiBase}/api/projects/${slug}/simulation/sessions/session-main/swarm/1`)
  expect(swarmResponse.ok()).toBe(true)
  const swarm = await swarmResponse.json()
  expect(swarm.contexts.length).toBeGreaterThan(0)

  await page.goto(`/project/${slug}/reports`)
  await expect(page.getByTestId('reports-view')).toBeVisible()
  await page.getByTestId('report-query-input').fill('Aria')
  await page.getByTestId('generate-report-button').click()
  await expect(page.getByTestId('report-body')).toContainText('## 引用')

  await page.getByTestId('interview-agents-input').fill('aria,kp')
  await page.getByTestId('interview-question-input').fill('你为什么这样行动？')
  await page.getByTestId('run-interview-button').click()
  await expect(page.getByTestId('interview-body')).toContainText('# Interview Record')

  const reportsResponse = await request.get(`${apiBase}/api/projects/${slug}/reports`)
  expect(reportsResponse.ok()).toBe(true)
  const reports = await reportsResponse.json()
  expect(reports.some((report: { path: string }) => report.path.includes('reports/simulation'))).toBe(true)
})
