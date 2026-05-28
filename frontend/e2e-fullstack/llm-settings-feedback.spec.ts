import { expect, test } from '@playwright/test'

const providerBase = process.env.PLAYWRIGHT_LLM_PROVIDER_BASE ?? 'http://127.0.0.1:50112/v1'

test('settings page gives visible feedback for provider model and healthcheck', async ({ page }) => {
  const slug = `llm-feedback-${Date.now()}`

  // Do not intercept /api/config/llm-healthcheck here: the browser must exercise
  // the real backend healthcheck route and backend provider call.
  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('LLM feedback acceptance')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.getByTestId('llm-provider-input').fill('local-browser-provider')
  await page.getByTestId('llm-base-url-input').fill(providerBase)
  await page.getByTestId('llm-api-key-input').fill('browser-local-key')
  await page.getByTestId('llm-api-style-select').selectOption('OpenAiChatCompletions')
  await page.getByTestId('llm-model-input').fill('generic-writer')

  await page.getByTestId('save-llm-endpoint-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 Endpoint / Key')

  await page.getByTestId('save-llm-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存默认模型')

  await page.getByTestId('test-llm-button').click()
  await expect(page.getByTestId('llm-health-result')).toContainText('LLM 可用')
  await expect(page.getByTestId('llm-health-result')).toContainText('Role: default')
  await expect(page.getByTestId('llm-health-result')).toContainText('generic-writer')
  await expect(page.getByTestId('llm-health-result')).toContainText('local-browser-provider')

  await page.getByTestId('llm-role-pick-button').filter({ hasText: 'kp' }).click()
  await expect(page.getByTestId('llm-role-id-input')).toHaveValue('kp')
  await page.getByTestId('llm-role-model-input').fill('kp-role-writer')
  await page.getByTestId('llm-role-style-select').selectOption('OpenAiChatCompletions')
  await page.getByTestId('save-role-llm-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 kp 的模型覆盖配置')
  await expect(page.getByTestId('llm-roles-list')).toContainText('kp → kp-role-writer · OpenAiChatCompletions')
  await page.getByTestId('test-role-llm-button').click()
  await expect(page.getByTestId('llm-health-result')).toContainText('LLM 可用')
  await expect(page.getByTestId('llm-health-result')).toContainText('Role: kp')
  await expect(page.getByTestId('llm-health-result')).toContainText('kp-role-writer')
  await expect(page.getByTestId('llm-health-result')).toContainText('OpenAiChatCompletions')
  await expect(page.getByTestId('llm-health-result')).toContainText('local-browser-provider')

  await page.reload()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByTestId('llm-provider-input')).toHaveValue('local-browser-provider')
  await expect(page.getByTestId('llm-model-input')).toHaveValue('generic-writer')
  await expect(page.getByTestId('llm-roles-list')).toContainText('kp → kp-role-writer · OpenAiChatCompletions')
  await page.getByTestId('llm-role-pick-button').filter({ hasText: 'kp' }).click()
  await expect(page.getByTestId('llm-role-id-input')).toHaveValue('kp')
  await expect(page.getByTestId('llm-role-model-input')).toHaveValue('kp-role-writer')
  await expect(page.getByTestId('llm-role-style-select')).toHaveValue('OpenAiChatCompletions')
})

test('settings healthcheck shows provider error categories through browser path', async ({ page }) => {
  const slug = `llm-errors-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('LLM provider error reporting acceptance')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await page.getByTestId('llm-provider-input').fill('local-error-provider')
  await page.getByTestId('llm-base-url-input').fill(providerBase)
  await page.getByTestId('llm-api-key-input').fill('bad-browser-key')
  await page.getByTestId('llm-api-style-select').selectOption('OpenAiChatCompletions')

  for (const [model, kind, status] of [
    ['auth-failure-writer', 'auth', '401'],
    ['model-not-found-writer', 'model_not_found', '404'],
    ['provider-5xx-writer', 'provider_5xx', '500'],
  ] as const) {
    await page.getByTestId('llm-base-url-input').fill(providerBase)
    await page.getByTestId('llm-model-input').fill(model)
    await page.getByTestId('save-llm-endpoint-button').click()
    await expect(page.getByTestId('llm-config-status')).toContainText('已保存 Endpoint / Key')
    await page.getByTestId('save-llm-button').click()
    await expect(page.getByTestId('llm-config-status')).toContainText('已保存默认模型')
    await page.getByTestId('test-llm-button').click()
    await expect(page.getByTestId('llm-health-result')).toContainText('LLM 不可用')
    await expect(page.getByTestId('llm-health-result')).toContainText(`Provider status: ${status}`)
    await expect(page.getByTestId('llm-health-result')).toContainText(kind)
  }

  await page.getByTestId('llm-base-url-input').fill('http://127.0.0.1:50199/v1')
  await page.getByTestId('llm-model-input').fill('generic-writer')
  await page.getByTestId('save-llm-endpoint-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 Endpoint / Key')
  await page.getByTestId('save-llm-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存默认模型')
  await page.getByTestId('test-llm-button').click()
  await expect(page.getByTestId('llm-health-result')).toContainText('LLM 不可用', { timeout: 20_000 })
  await expect(page.getByTestId('llm-health-result')).toContainText('network')
})
