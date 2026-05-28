import { expect, test } from '@playwright/test'

const providerBase = process.env.PLAYWRIGHT_LLM_PROVIDER_BASE ?? 'http://127.0.0.1:50112/v1'

test('import report exposes LLM semantic extraction failure instead of guessed cards', async ({ page }) => {
  const slug = `llm-required-failure-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('Browser path verifies LLM-required import failure report')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.getByTestId('novel-file-input').setInputFiles('../test_novel.txt')
  await expect(page.getByTestId('import-status')).toContainText('已导入 test_novel.txt')
  await expect(page.getByTestId('import-report')).toContainText('test_novel.txt')
  await expect(page.getByTestId('import-extraction-status')).toContainText('LLM semantic extraction: llm_failed')
  await expect(page.getByTestId('import-extraction-message')).toContainText(/no LLM endpoint|semantic cards were not generated|failed/i)
  await expect(page.getByTestId('import-report')).toContainText(/cards=1|Cards: import-/)

  await expect(page.getByTestId('settings-view')).not.toContainText('叶小伟')
})

test('import report exposes invalid LLM schema without guessed semantic cards', async ({ page }) => {
  const slug = `llm-invalid-schema-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('Browser path verifies invalid schema import report')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.getByTestId('llm-provider-input').fill('local-invalid-schema-provider')
  await page.getByTestId('llm-base-url-input').fill(providerBase)
  await page.getByTestId('llm-api-key-input').fill('invalid-schema-key')
  await page.getByTestId('llm-api-style-select').selectOption('OpenAiChatCompletions')
  await page.getByTestId('llm-model-input').fill('invalid-schema-writer')
  await page.getByTestId('save-llm-endpoint-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 Endpoint / Key')
  await page.getByTestId('save-llm-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存默认模型')

  await page.getByTestId('novel-file-input').setInputFiles('../test_novel.txt')
  await expect(page.getByTestId('import-status')).toContainText('已导入 test_novel.txt')
  await expect(page.getByTestId('import-extraction-status')).toContainText('LLM semantic extraction: llm_failed')
  await expect(page.getByTestId('import-extraction-message')).toContainText('invalid or empty JSON')
  await expect(page.getByTestId('import-report')).toContainText(/cards=1|Cards: import-/)
  await expect(page.getByTestId('settings-view')).not.toContainText('叶小伟')
})
