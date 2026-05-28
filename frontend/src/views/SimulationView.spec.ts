import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SimulationView from './SimulationView.vue'

const ensureProject = vi.fn()
const createSimulationSession = vi.fn()
const advanceSimulation = vi.fn()
const getSwarmRound = vi.fn()
const possessCharacter = vi.fn()
const route = { params: { slug: 'alpha-project' } }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

vi.mock('../lib/workspace', () => ({
  ensureProject: (...args: unknown[]) => ensureProject(...args),
  createSimulationSession: (...args: unknown[]) => createSimulationSession(...args),
  advanceSimulation: (...args: unknown[]) => advanceSimulation(...args),
  getSwarmRound: (...args: unknown[]) => getSwarmRound(...args),
  possessCharacter: (...args: unknown[]) => possessCharacter(...args),
  formatSwarmActionLabel: (action: { type: string; path?: string; marker?: string; old?: string }) => {
    switch (action.type) {
      case 'replace_project_section':
        return `replace_section -> ${action.path ?? ''}${action.old ? ` [${action.old.trim()}]` : ''}`
      case 'append_project_section':
        return `append_section -> ${action.path ?? ''}${action.marker ? ` [${action.marker.trim()}]` : ''}`
      default:
        return `${action.type}${action.path ? ` -> ${action.path}` : ''}`
    }
  },
}))

describe('SimulationView', () => {
  beforeEach(() => {
    ensureProject.mockReset()
    createSimulationSession.mockReset()
    advanceSimulation.mockReset()
    getSwarmRound.mockReset()
    possessCharacter.mockReset()
  })

  it('renders restricted runtime plan after advancing a round', async () => {
    ensureProject.mockResolvedValue({
      slug: 'alpha-project',
      title: 'Alpha',
      description: 'Desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      cards: [{ id: 'aria', kind: 'character', title: 'Aria', body: 'Protect the vault' }],
      memory: [],
      chapters: [],
      simulation: {
        sessionId: 'session-main',
        round: 0,
        possessedCharacterId: '',
        logs: [],
        characters: [{ characterId: 'aria', displayName: 'Aria', agenda: 'Protect the vault', controller: 'agent' }],
      },
      branches: [],
    })
    advanceSimulation.mockResolvedValue({
      sessionId: 'session-main',
      round: 1,
      possessedCharacterId: '',
      logs: [{ round: 1, actor: 'aria', role: 'character', summary: 'Aria protects the vault gate.' }],
      characters: [{ characterId: 'aria', displayName: 'Aria', agenda: 'Protect the vault', controller: 'agent' }],
    })
    getSwarmRound.mockResolvedValue({
      sessionId: 'session-main',
      round: 1,
      timepointId: '0001',
      contexts: [],
      outputs: [{
        agentId: 'aria',
        role: 'project-auditor',
        intent: 'project_audit',
        reasoningSummary: 'Latest structured action for aria | skills=kp-adjudicate.md | scope=rules',
        evidence: ['cards/characters/aria.md'],
        consistencyChecks: { ooc: 'PASS', world: 'PASS', timeline: 'PASS', rules: 'PASS' },
        actions: [{ type: 'append_memory', path: 'agents/aria/memory.md' }, { type: 'replace_project_section', path: 'history/project-audit-log.md', old: '## Runtime Notes', content: '- round 1 :: project audit note persisted' }],
        skillInvocations: [{
          skillFile: 'kp-adjudicate.md',
          intent: 'kp_adjudicate',
          target: 'cards/rules',
          mode: 'replace_section',
          scope: 'rules',
          consistency: 'rules',
          selectedAction: 'replace_project_section',
          selectedPath: 'history/project-audit-log.md',
          evidencePaths: ['agents/kp/skills/kp-adjudicate.md', 'cards/rules/runtime-kp-rulings.md'],
          status: 'PASS',
          warnReason: null,
        }, {
          skillFile: 'broken-skill.md',
          intent: 'kp_adjudicate',
          target: null,
          mode: null,
          scope: null,
          consistency: null,
          selectedAction: 'replace_project_section',
          selectedPath: 'history/project-audit-log.md',
          evidencePaths: ['agents/kp/skills/broken-skill.md'],
          status: 'WARN',
          warnReason: "invalid skill frontmatter: missing target, mode, scope, consistency; repair this agent's skills/broken-skill.md in Settings Agent assets before trusting this invocation",
        }],
      }],
    })

    const wrapper = mount(SimulationView)
    await flushPromises()
    await wrapper.get('[data-testid="advance-round-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="runtime-plan-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Planned Runtime Actions')
    expect(wrapper.text()).toContain('append_memory')
    expect(wrapper.text()).toContain('append_memory -> agents/aria/memory.md')
    expect(wrapper.text()).toContain('replace_section -> history/project-audit-log.md')
    expect(wrapper.find('[data-testid="system-updates-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Observed File Updates')
    expect(wrapper.text()).toContain('history/project-audit-log.md')
    expect(wrapper.text()).toContain('project audit note persisted')
    expect(wrapper.text()).toContain('project-auditor · project_audit · replace_project_section')
    expect(wrapper.text()).toContain('replace_project_section')
    expect(wrapper.text()).toContain('## Runtime Notes')
    expect(wrapper.text()).toContain('before: ## Runtime Notes')
    expect(wrapper.text()).toContain('because: skills=kp-adjudicate.md')
    expect(wrapper.text()).toContain('scope=rules')
    expect(wrapper.text()).toContain('planner decision explanation')
    expect(wrapper.text()).toContain('target selected by project-auditor/project_audit')
    expect(wrapper.text()).toContain('mode selected by replace_project_section')
    expect(wrapper.find('[data-testid="skill-invocation-list"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Skill contract / planner evidence')
    expect(wrapper.text()).toContain('kp-adjudicate.md')
    expect(wrapper.text()).toContain('intent=kp_adjudicate')
    expect(wrapper.text()).toContain('target=cards/rules')
    expect(wrapper.text()).toContain('mode=replace_section')
    expect(wrapper.text()).toContain('selected replace_project_section → history/project-audit-log.md')
    expect(wrapper.text()).toContain('agents/kp/skills/kp-adjudicate.md')
    expect(wrapper.text()).toContain('broken-skill.md')
    expect(wrapper.text()).toContain('WARN')
    expect(wrapper.text()).toContain('warn/block: invalid skill frontmatter')
    expect(wrapper.text()).toContain("repair this agent's skills/broken-skill.md in Settings Agent assets")
    expect(wrapper.text()).toContain('tuning entrypoint for project-auditor')
    expect(wrapper.text()).toContain('step 1: go to 项目设定 → Agent 资产, select project-auditor, then open agents/aria/skills/*.md')
    expect(wrapper.text()).toContain('step 2: review keys target/mode/scope')
    expect(wrapper.text()).toContain('step 3: compare current inferred values skills=kp-adjudicate.md')
  })
})
