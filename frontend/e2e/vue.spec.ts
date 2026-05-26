import { expect, test } from '@playwright/test'

test('knowledge simulation report and interview flow works in browser acceptance path', async ({ page }) => {
  const project = {
    slug: 'alpha-project',
    title: 'Alpha Project',
    description: 'Acceptance project',
  }

  const session = {
    session_id: 'session-main',
    title: 'Alpha Project 推演',
    round: 1,
    timepoint_id: '0001',
    active_character_id: null,
    characters: [
      {
        character_id: 'aria',
        display_name: 'Aria',
        agenda: 'Protect the vault',
        controller: { kind: 'agent' },
      },
    ],
    logs: [
      { round: 1, actor_id: 'aria', role: 'character', summary: 'Aria protects the vault gate.' },
      { round: 1, actor_id: 'kp', role: 'kp', summary: 'KP confirms the vault rule applies.' },
    ],
  }

  const swarmRound = {
    session_id: 'session-main',
    round: 1,
    timepoint_id: '0001',
    contexts: [
      {
        agent_id: 'aria',
        role: 'project-auditor',
        intent: 'project_audit',
        reasoning_summary: 'Latest structured action for aria: Aria protects the vault gate.',
        evidence: ['cards/characters/aria.md'],
        consistency_checks: { ooc: 'PASS', world: 'PASS', timeline: 'PASS', rules: 'PASS' },
        rag_hits: [{ fact: 'Aria: protects the vault', source_path: 'cards/characters/aria.md', timeline: null, timepoint: null, score: 1 }],
      },
    ],
    outputs: [
      {
        agent_id: 'aria',
        role: 'project-auditor',
        intent: 'project_audit',
        reasoning_summary: 'Latest structured action for aria: Aria protects the vault gate. | soul=Aria Soul | memory=Aria Memory | skills=kp-adjudicate.md | scope=rules',
        evidence: ['cards/characters/aria.md'],
        consistency_checks: { ooc: 'PASS', world: 'PASS', timeline: 'PASS', rules: 'PASS' },
        actions: [
          { type: 'append_audit', path: 'agents/aria/audit/runtime-round-log.md', content: '- round 1 session session-main' },
          { type: 'append_memory', path: 'agents/aria/memory.md', content: '- round 1 timepoint 0001' },
          { type: 'replace_project_section', path: 'history/project-audit-log.md', old: '## Runtime Notes', content: '- round 1 :: project audit note persisted' },
        ],
      },
    ],
  }

  const report = {
    id: 'session-main-round-0001',
    kind: 'simulation',
    title: 'Alpha round 1 report',
    path: 'reports/simulation/session-main-round-0001.md',
    body: '# 推演报告\n\n## 系统角色落盘结果\n- history/project-audit-log.md :: project audit note persisted\n\n## 引用\n- `cards/characters/aria.md`',
  }


  const consistencyReport = {
    id: 'session-main-round-0001-consistency',
    kind: 'consistency',
    title: 'Consistency audit',
    path: 'reports/consistency/session-main-round-0001-consistency.md',
    body: '# 一致性审计报告',
  }

  const branchImpactReport = {
    id: 'branch-a-impact',
    kind: 'branch-impact',
    title: 'Branch impact',
    path: 'reports/branch-impact/branch-a-impact.md',
    body: '# 分支影响分析',
  }

  const prewriteReport = {
    id: 'chapter-001-prewrite',
    kind: 'writing',
    title: 'Prewrite report',
    path: 'reports/writing/chapter-001-prewrite.md',
    body: '# 续写预备报告',
  }

  const interview = {
    id: 'interview-round-0001',
    session_id: 'session-main',
    path: 'simulation/sessions/session-main/interviews/interview-round-0001.md',
    body: '# Interview Record\n\n## Agent: kp\n### Q: 你为什么这样行动？\n依据已落盘事实回答。',
  }

  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [project] })
      return
    }
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: project })
      return
    }
    await route.fallback()
  })

  await page.route('**/api/projects/alpha-project', async (route) => {
    await route.fulfill({ json: project })
  })

  await page.route('**/api/projects/alpha-project/cards', async (route) => {
    await route.fulfill({ json: [{ id: 'aria', kind: 'character', title: 'Aria', body: 'Protects the vault.' }] })
  })

  await page.route('**/api/projects/alpha-project/memory?scope=global', async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.route('**/api/projects/alpha-project/writing/chapters', async (route) => {
    await route.fulfill({ json: [{ id: 'chapter-001', title: 'Chapter 1', is_current: true }] })
  })

  await page.route('**/api/projects/alpha-project/writing/chapters/chapter-001', async (route) => {
    await route.fulfill({ json: { id: 'chapter-001', title: 'Chapter 1', body: 'Body', review_notes: [] } })
  })

  await page.route('**/api/projects/alpha-project/timeline/branches', async (route) => {
    await route.fulfill({ json: [{ id: 'branch-a', title: 'Branch A', description: 'branch desc', origin_timepoint_id: '0001', timepoint_ids: [] }] })
  })

  await page.route('**/api/projects/alpha-project/agents', async (route) => {
    await route.fulfill({ json: [{ agent_id: 'aria', soul_title: 'Aria', skill_count: 1 }] })
  })

  await page.route('**/api/projects/alpha-project/simulation/active-session', async (route) => {
    await route.fulfill({ json: session })
  })

  await page.route('**/api/projects/alpha-project/simulation/sessions', async (route) => {
    await route.fulfill({ json: session })
  })

  await page.route('**/api/projects/alpha-project/simulation/sessions/session-main/advance', async (route) => {
    await route.fulfill({ json: session })
  })

  await page.route('**/api/projects/alpha-project/simulation/sessions/session-main/swarm/1', async (route) => {
    await route.fulfill({ json: swarmRound })
  })

  await page.route('**/api/projects/alpha-project/knowledge/rebuild', async (route) => {
    await route.fulfill({ json: { node_count: 1, edge_count: 0, episode_count: 1, chunk_count: 1 } })
  })

  await page.route('**/api/projects/alpha-project/knowledge/graph/nodes', async (route) => {
    await route.fulfill({ json: [{ id: 'character:aria', name: 'Aria', labels: ['Character'], summary: 'Protects the vault', source_paths: ['cards/characters/aria.md'] }] })
  })

  await page.route('**/api/projects/alpha-project/knowledge/graph/episodes', async (route) => {
    await route.fulfill({ json: [{ id: 'episode:1', timeline: 'main', timepoint: '0001', source_path: 'simulation/logs/session-main.md', summary: 'Aria protects the vault gate.' }] })
  })

  await page.route('**/api/projects/alpha-project/rag/quick?*', async (route) => {
    await route.fulfill({ json: { query: 'Aria', hits: [{ fact: 'Aria: protects the vault', source_path: 'cards/characters/aria.md', timeline: null, timepoint: null, score: 1 }] } })
  })

  await page.route('**/api/projects/alpha-project/rag/panorama?*', async (route) => {
    await route.fulfill({ json: { query: 'Aria', active_facts: [{ fact: 'Aria: protects the vault', source_path: 'cards/characters/aria.md', timeline: null, timepoint: null, score: 1 }], historical_facts: [], nodes: [{ id: 'character:aria', name: 'Aria', labels: ['Character'], summary: 'Protects the vault', source_paths: ['cards/characters/aria.md'] }], edges: [] } })
  })

  await page.route('**/api/projects/alpha-project/rag/insight?*', async (route) => {
    await route.fulfill({ json: { query: 'Aria', sub_queries: ['Aria'], facts: [{ fact: 'Aria: protects the vault', source_path: 'cards/characters/aria.md', timeline: null, timepoint: null, score: 1 }], relationship_chains: ['character:aria -[PROTECTS]-> vault'], risk_notes: ['No active conflict.'] } })
  })

  await page.route('**/api/projects/alpha-project/reports', async (route) => {
    await route.fulfill({ json: [report, consistencyReport, branchImpactReport, prewriteReport] })
  })

  await page.route('**/api/projects/alpha-project/reports/simulation', async (route) => {
    await route.fulfill({ json: report })
  })

  await page.route('**/api/projects/alpha-project/reports/consistency', async (route) => {
    await route.fulfill({ json: consistencyReport })
  })

  await page.route('**/api/projects/alpha-project/reports/branch-impact', async (route) => {
    await route.fulfill({ json: branchImpactReport })
  })

  await page.route('**/api/projects/alpha-project/reports/writing-prewrite', async (route) => {
    await route.fulfill({ json: prewriteReport })
  })

  await page.route('**/api/projects/alpha-project/reports/simulation/session-main-round-0001', async (route) => {
    await route.fulfill({ json: report })
  })

  await page.route('**/api/projects/alpha-project/simulation/sessions/session-main/interview', async (route) => {
    await route.fulfill({ json: interview })
  })

  await page.goto('/')
  await expect(page.getByTestId('project-list')).toContainText('Alpha Project')
  await page.getByTestId('open-alpha-project').click()

  await expect(page.getByTestId('tab-knowledge')).toBeVisible()
  await page.getByTestId('tab-knowledge').click()
  await expect(page.getByTestId('knowledge-view')).toBeVisible()
  await expect(page.getByTestId('rag-hit')).toContainText('Aria: protects the vault')

  await page.getByTestId('tab-simulation').click()
  await expect(page.getByTestId('simulation-view')).toBeVisible()
  await page.getByTestId('advance-round-button').click()
  await expect(page.getByTestId('swarm-round-panel')).toContainText('StorySwarm 审计')
  await expect(page.getByTestId('runtime-plan-panel')).toContainText('Planned Runtime Actions')
  await expect(page.getByTestId('runtime-plan-panel')).toContainText('append_memory')
  await expect(page.getByTestId('system-updates-panel')).toContainText('Observed File Updates')
  await expect(page.getByTestId('system-updates-panel')).toContainText('project audit note persisted')
  await expect(page.getByTestId('system-updates-panel')).toContainText('project-auditor · project_audit · replace_project_section')
  await expect(page.getByTestId('system-updates-panel')).toContainText('replace_project_section')
  await expect(page.getByTestId('system-updates-panel')).toContainText('## Runtime Notes')
  await expect(page.getByTestId('system-updates-panel')).toContainText('before: ## Runtime Notes')
  await expect(page.getByTestId('system-updates-panel')).toContainText('because: skills=kp-adjudicate.md')
  await expect(page.getByTestId('system-updates-panel')).toContainText('planner decision explanation')
  await expect(page.getByTestId('system-updates-panel')).toContainText('tuning entrypoint for project-auditor')
  await expect(page.getByTestId('system-updates-panel')).toContainText('step 1: go to 项目设定 → Agent 资产, select project-auditor, then open agents/aria/skills/*.md')
  await expect(page.getByTestId('system-updates-panel')).toContainText('step 2: review keys target/mode/scope')
  await expect(page.getByTestId('system-updates-panel')).toContainText('target selected by project-auditor/project_audit')
  await expect(page.getByTestId('system-updates-panel')).toContainText('scope=rules')

  await page.getByTestId('tab-reports').click()
  await expect(page.getByTestId('reports-view')).toBeVisible()
  await page.getByTestId('generate-report-button').click()
  await expect(page.getByTestId('report-body')).toContainText('# 推演报告')
  await expect(page.getByTestId('report-system-role-hint')).toContainText('本报告已纳入系统角色落盘结果摘要')
  await expect(page.getByTestId('report-kind-hint')).toContainText('该推演报告综合了 StoryRAG、StorySwarm 与系统角色落盘结果。')
  await expect(page.getByTestId('report-body')).toContainText('## 系统角色落盘结果')
  await page.getByTestId('generate-consistency-report-button').click()
  await expect(page.getByTestId('report-body')).toContainText('# 一致性审计报告')
  await expect(page.getByTestId('report-kind-hint')).toContainText('该一致性审计报告会优先强调 StorySwarm 检查结果与系统角色落盘摘要。')
  await page.getByTestId('branch-id-input').fill('branch-a')
  await page.getByTestId('generate-branch-impact-button').click()
  await expect(page.getByTestId('report-body')).toContainText('# 分支影响分析')
  await page.getByTestId('chapter-id-input').fill('chapter-001')
  await page.getByTestId('generate-prewrite-report-button').click()
  await expect(page.getByTestId('report-body')).toContainText('# 续写预备报告')
  await page.getByTestId('run-interview-button').click()
  await expect(page.getByTestId('interview-body')).toContainText('# Interview Record')
})
