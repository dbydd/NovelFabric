# Global Prompt Skill Stack

Use global prompt skills for generic prompting problems. Use local files here for placement, audit, and operator-facing scope.

## Available global skills

- `prompt-engineering-patterns` — prompt structure, few-shot design, and framing quality
- `ai-prompt-engineering-safety-review` — safety and robustness review for prompts
- `boost-prompt` — refining a vague request before writing tooling text

## Usage order

1. Read `AGENTS.md`, `SOUL.md`, and `template.json`.
2. Use a global prompt skill only for the generic prompting issue.
3. Return here for `tools/` vs `artifacts/` placement, protected-surface rules, and completion evidence.

## Local-vs-global rule

- Global skills solve the broad prompt-design problem.
- Local files here decide where the result lives, what is protected, and what evidence counts as done.
- Do not copy a large generic framework into this workspace unless it changes operator behavior locally.
