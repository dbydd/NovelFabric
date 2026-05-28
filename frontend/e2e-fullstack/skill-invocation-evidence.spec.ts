import { expect, test } from '@playwright/test'

const providerBase = process.env.PLAYWRIGHT_LLM_PROVIDER_BASE ?? 'http://127.0.0.1:50112/v1'

test('settings skill body edits drive visible simulation skill invocation evidence', async ({ page }) => {
  const slug = `skill-evidence-${Date.now()}`

  await page.goto('/novelfabric/')
  await page.getByTestId('project-title-input').fill(slug)
  await page.getByTestId('project-description-input').fill('Skill invocation evidence acceptance')
  await page.getByTestId('create-project-button').click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  // This browser path uses the real backend import and health/provider config flow.
  await page.getByTestId('llm-provider-input').fill('local-goal3-provider')
  await page.getByTestId('llm-base-url-input').fill(providerBase)
  await page.getByTestId('llm-api-key-input').fill('goal3-local-key')
  await page.getByTestId('llm-api-style-select').selectOption('OpenAiChatCompletions')
  await page.getByTestId('llm-model-input').fill('generic-writer')
  await page.getByTestId('save-llm-endpoint-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 Endpoint / Key')
  await page.getByTestId('save-llm-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存默认模型')
  await page.getByTestId('novel-file-input').setInputFiles('../test_novel.txt')
  await expect(page.getByTestId('import-extraction-status')).toContainText('llm_succeeded', { timeout: 30_000 })

  await page.getByTestId('agent-card').filter({ hasText: 'kp' }).click()
  await expect(page.getByTestId('agent-editor')).toBeVisible()
  await page.getByTestId('select-skill-button').filter({ hasText: 'kp-adjudicate.md' }).click()
  await expect(page.getByTestId('skill-file-input')).toHaveValue('kp-adjudicate.md')
  await expect(page.getByTestId('skill-body-input')).toHaveValue(/intent: kp_adjudicate/)
  await page.getByTestId('skill-body-input').fill('---\nintent: kp_adjudicate\ntarget: simulation/logs\nmode: append\nscope: project\nconsistency: rules\npriority: high\n---\n# kp-adjudicate\n\n## Contract\n- Route KP decisions through visible skill invocation evidence.\n')
  await page.getByTestId('save-skill-button').click()
  await expect(page.getByTestId('llm-config-status')).toContainText('已保存 skill：kp-adjudicate.md')

  await page.getByTestId('tab-simulation').click()
  await page.getByTestId('advance-count-input').fill('1')
  await page.getByTestId('advance-batch-button').click()
  await expect(page.getByTestId('swarm-round-panel')).toContainText('Round 1')
  await expect(page.getByTestId('runtime-plan-panel')).toBeVisible()
  await expect(page.getByTestId('skill-invocation-card').filter({ hasText: 'kp-adjudicate.md' })).toContainText('target=simulation/logs')
  await expect(page.getByTestId('skill-invocation-card').filter({ hasText: 'kp-adjudicate.md' })).toContainText('mode=append')
  await expect(page.getByTestId('skill-invocation-card').filter({ hasText: 'kp-adjudicate.md' })).toContainText('selected append_project_section → simulation/logs/skill-runtime.md')
  await expect(page.getByTestId('skill-invocation-card').filter({ hasText: 'kp-adjudicate.md' })).toContainText('agents/kp/skills/kp-adjudicate.md')
})
