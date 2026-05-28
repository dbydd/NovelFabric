import { expect, test } from '@playwright/test'

const llmProviderBase = process.env.PLAYWRIGHT_LLM_PROVIDER_BASE ?? 'http://127.0.0.1:50112/v1'

test('strict browser acceptance imports fixture builds assets simulates ten rounds and exports writing', async ({ page }) => {
  const slug = `strict-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('Strict test_novel browser acceptance')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.getByTestId('llm-provider-input').fill('local-strict-provider')
  await page.getByTestId('llm-base-url-input').fill(llmProviderBase)
  await page.getByTestId('llm-api-key-input').fill('browser-acceptance-key')
  await page.getByTestId('llm-model-input').fill('generic-writer')
  await page.getByTestId('llm-api-style-select').selectOption('OpenAiChatCompletions')
  await page.getByTestId('save-llm-endpoint-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText(/Endpoint/i)
  await page.getByTestId('save-llm-button').click()

  await page.getByTestId('novel-file-input').setInputFiles('../test_novel.txt')
  await expect(page.getByTestId('import-status')).toContainText('test_novel.txt')
  await expect(page.getByTestId('import-report')).toContainText(/1[0-9]|[2-9][0-9]/)
  await expect(page.getByTestId('settings-view')).toContainText('叶小伟')

  await page.getByTestId('tab-knowledge').click()
  await page.getByTestId('rag-query-input').fill('叶小伟')
  await page.getByTestId('rebuild-knowledge-button').click()
  await expect(page.getByTestId('rebuild-knowledge-button')).toHaveText('重建并检索')
  await expect(page.getByTestId('knowledge-stats')).toContainText('Nodes')
  await expect(page.getByTestId('rag-graph-visualization')).toContainText('nodes')
  await expect(page.getByTestId('rag-edge-list')).toContainText(/MENTIONED_IN|VALID_IN_TIMELINE/)
  await expect(page.getByTestId('graph-node')).toContainText('叶小伟')
  await expect(page.getByTestId('rag-hit')).toContainText(/cards\/characters|memory|import/)

  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('agent-overview')).toContainText('叶小伟')
  await page.getByTestId('agent-card').filter({ hasText: '叶小伟' }).click()
  await expect(page.getByTestId('agent-editor')).toContainText('soul.md')
  await expect(page.getByTestId('agent-soul-input')).toHaveValue(/叶小伟/)
  await expect(page.getByTestId('agent-memory-input')).toHaveValue(/来源：导入拆书/)
  await expect(page.getByTestId('skill-manager')).toContainText('character-decision.md')

  await page.getByTestId('tab-simulation').click()
  await page.getByTestId('advance-count-input').fill('10')
  await page.getByTestId('advance-batch-button').click()
  await expect(page.getByTestId('sim-timeline')).toContainText('Round 10', { timeout: 30_000 })
  const simulationLogs = await page.getByTestId('simulation-log').count()
  expect(simulationLogs).toBeGreaterThan(10)
  await expect(page.getByTestId('swarm-round-panel')).toContainText('Round 10')

  await page.getByTestId('tab-writing').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-writing-button').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`${slug}-writing.txt`)

  await page.getByTestId('tab-settings').click()
  await page.reload()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByTestId('llm-model-input')).toHaveValue('generic-writer')
  await expect(page.getByTestId('llm-base-url-input')).toHaveValue(llmProviderBase)
})
