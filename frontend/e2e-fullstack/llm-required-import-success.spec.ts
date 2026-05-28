import { expect, test } from '@playwright/test'

const providerBase = process.env.PLAYWRIGHT_LLM_PROVIDER_BASE ?? 'http://127.0.0.1:50112/v1'

test('configured local provider drives LLM semantic import success through browser path', async ({ page }) => {
  const slug = `llm-required-success-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('Browser path verifies configured LLM semantic extraction success')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.getByTestId('llm-provider-input').fill('local-browser-provider')
  await page.getByTestId('llm-base-url-input').fill(providerBase)
  await page.getByTestId('llm-api-key-input').fill('browser-local-key')
  await page.getByTestId('llm-api-style-select').selectOption('OpenAiChatCompletions')
  await page.getByTestId('llm-model-input').fill('local-semantic-writer')
  await page.getByTestId('save-llm-endpoint-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 Endpoint / Key')
  await page.getByTestId('save-llm-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存默认模型')
  await page.getByTestId('test-llm-button').click()
  await expect(page.getByTestId('llm-health-result')).toContainText('LLM 可用')
  await expect(page.getByTestId('llm-health-result')).toContainText('local-semantic-writer')

  await page.getByTestId('novel-file-input').setInputFiles('../test_novel.txt')
  await expect(page.getByTestId('import-status')).toContainText('已导入 test_novel.txt')
  await expect(page.getByTestId('import-extraction-status')).toContainText('LLM semantic extraction: llm_succeeded')
  await expect(page.getByTestId('import-extraction-message')).toContainText('LLM semantic extraction succeeded')
  await expect(page.getByTestId('import-llm-model')).toContainText('local-semantic-writer')
  await expect(page.getByTestId('settings-view')).toContainText('叶小伟')
  await page.getByTestId('card-kind-world').click()
  await expect(page.getByTestId('card-list')).toContainText('源初车站')
  await page.getByTestId('card-kind-rule').click()
  await expect(page.getByTestId('card-list')).toContainText('穿越后知识边界')
  await page.getByTestId('card-kind-character').click()

  await page.getByTestId('agent-card').filter({ hasText: '叶小伟' }).click()
  await expect(page.getByTestId('agent-soul-input')).toHaveValue(/LLM 身份与动机提取/)
  await expect(page.getByTestId('agent-soul-input')).toHaveValue(/Confidence\n0\.93/)
  await expect(page.getByTestId('agent-soul-input')).toHaveValue(/Knowledge Boundary/)
  await expect(page.getByTestId('agent-soul-input')).toHaveValue(/source_path|path: import\/chapters/)
  await expect(page.getByTestId('skill-manager')).toContainText('character-decision.md')

  await page.getByTestId('card-kind-rule').click()
  await expect(page.getByTestId('card-list')).toContainText('LLM 抽取质量与技能建议')
  await page.getByTestId('card-list-item').filter({ hasText: 'LLM 抽取质量与技能建议' }).click()
  await expect(page.getByTestId('card-body-input')).toHaveValue(/源初车站的完整规则证据不足/)
  await expect(page.getByTestId('card-body-input')).toHaveValue(/叶小伟行动前必须引用当前章节证据/)
  await expect(page.getByTestId('card-body-input')).toHaveValue(/intent: character-decision/)
})
