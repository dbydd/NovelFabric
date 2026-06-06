# NovelFabric V4 CLI Command Contract

> Status: planning contract. This document defines the CLI-first target surface for the V4 workspace harness. Commands listed here are the intended executable boundary before Web UI or pi agent SDK orchestration is considered complete.

## 1. Contract Rules

Every command must:

- use the single `novelfabric` entrypoint;
- accept `--json` for machine-readable output;
- return a stable envelope:
  - success: `{ "ok": true, "command": "...", "data": { ... } }`
  - failure: `{ "ok": false, "error": { "code": "...", "message": "..." } }`
- resolve paths inside a workspace root;
- route durable writes through shared workspace services;
- apply capability and protected-path checks before writing;
- write auditable artifacts or audit records for state changes;
- be safe for pi/Hermes agents to call repeatedly.

Semantic reasoning should be performed by the NovelFabric mono app's wrapped pi agent SDK runtime or by external agents using NovelFabric skills and context packs. NovelFabric CLI commands own runtime policy, context preparation, validation, apply, audit, and reporting. For Web users, the wrapped runtime must use NovelFabric-owned pi config/extension paths and must not expose raw dangerous tools such as unrestricted `bash`, `write`, or `edit`.

## 2. Current Implementation Status

| Family                                    | Status                           | Notes                                                                                                                  |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `config`, `workspace`, `project`, `files` | implemented                      | Includes audited write/append/patch, symlink rejection, workspace materialization and validation.                      |
| `runtime`                                 | implemented shell                | Materializes NovelFabric-owned pi config/policy/extension metadata; real extension execution still pending.            |
| `agents`, `skills`                        | implemented                      | Inspection/validation of text assets; materialization remains limited.                                                 |
| `import`                                  | implemented deterministic        | Normalize/chunk/chapterize/context-pack are deterministic, not semantic拆书.                                           |
| `cards`, `memory`                         | implemented proposal/apply shell | Citation/hash validation exists; semantic proposal quality needs pi-backed tasks.                                      |
| `knowledge`, `recall`, `context-pack`     | implemented deterministic        | Derived index/search/context packs exist; no vector/LLM ranking yet.                                                   |
| `simulation`, `swarm`                     | implemented task shell           | Deterministic session/plan/task artifacts exist; real role reasoning requires pi tasks.                                |
| `report`, `writing`                       | implemented task shell           | Report/writing task artifacts and apply/review/export exist; real ReportAgent/chapter drafting requires pi evidence.   |
| `agent`                                   | implemented shell                | Task package and run envelope exist; `agent run --runtime pi` does not yet start a real pi AgentSession.               |
| `workflow`                                | implemented state shell          | Job plan/start/step/status/retry/cancel/verify exist; semantic stages remain task artifacts until pi runtime is wired. |
| `external-swarm`                          | implemented CLI wrapper          | Deterministic compatibility artifacts and idempotency exist; REST/MCP adapters and golden tests remain pending.        |
| `web`                                     | partial                          | File bridge/editor exists; full workflow/runtime Web binding and Playwright acceptance remain pending.                 |

This table is a progress ledger, not a success declaration. See `../qa/v4-full-usability-acceptance.md` for the acceptance standard.

## 3. Error Codes

| Code                      | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `invalid_request`         | CLI flags or JSON input are malformed.                      |
| `workspace_not_found`     | Workspace root cannot be resolved.                          |
| `path_outside_workspace`  | Requested path escapes workspace root.                      |
| `file_not_found`          | Required workspace file is missing.                         |
| `capability_denied`       | Actor lacks required capability.                            |
| `protected_write_denied`  | Target is protected and actor cannot patch protected files. |
| `file_conflict`           | Base hash changed since read.                               |
| `invalid_artifact`        | Proposal/artifact schema validation failed.                 |
| `missing_evidence`        | Artifact lacks required source citations.                   |
| `agent_unavailable`       | pi agent SDK/session cannot be started.                     |
| `stage_blocked`           | Workflow stage has unresolved blockers.                     |
| `compatibility_violation` | External swarm contract shape would be broken.              |

## 4. Capability Names

Initial target capabilities:

```text
project.manage
workspace.materialize
files.write
files.patch_allowed
files.patch_protected
import.add
import.normalize
cards.propose
cards.apply
knowledge.rebuild
knowledge.query
memory.recall
memory.write_own
memory.propose_shared
simulation.create
simulation.append_turn
swarm.run
external_swarm.run
report.render
report.apply
chapter.apply
runtime.manage
runtime.extension.manage
agent.task.run
```

Deny rules override allow rules.

## 5. Workspace / Project Commands

```bash
novelfabric workspace doctor --path <workspace> --json
novelfabric workspace print-layout --json
novelfabric workspace inspect --workspace <workspace> --json
novelfabric workspace validate --workspace <workspace> --json
novelfabric workspace materialize --workspace <workspace> --template novel-project --actor main_agent --json

novelfabric project init --path <workspace> --name <title> --json
novelfabric project inspect --workspace <workspace> --json
novelfabric project validate --workspace <workspace> --json
novelfabric project list --root <root> --json
```

Writes require `workspace.materialize` or `project.manage`.

## 6. Files Commands

Existing commands remain foundational:

```bash
novelfabric files tree --workspace <workspace> --json
novelfabric files read --workspace <workspace> --path <path> --json
novelfabric files write --workspace <workspace> --path <path> --actor <actor> --stdin --json
```

Planned extensions:

```bash
novelfabric files glob --workspace <workspace> --base <dir> --pattern '**/*.md' --json
novelfabric files stat --workspace <workspace> --path <path> --json
novelfabric files append --workspace <workspace> --path <path> --actor <actor> --stdin --json
novelfabric files patch --workspace <workspace> --path <path> --actor <actor> --patch <patch.json> --json
novelfabric files protect-check --workspace <workspace> --path <path> --actor <actor> --json
```

All mutations require `files.write` or `project.manage`; protected paths require `files.patch_protected`.

## 7. Runtime Config / Extension Commands

```bash
novelfabric runtime doctor --json
novelfabric runtime config path --json
novelfabric runtime config inspect --json
novelfabric runtime materialize --actor main_agent --json
novelfabric runtime extensions list --json
novelfabric runtime extensions validate --json
novelfabric runtime policy inspect --profile web-safe --json
```

Runtime commands manage the NovelFabric-owned pi SDK envelope, not a separate LLM provider stack. They resolve configuration under:

```text
$XDG_CONFIG_HOME/novelfabric/pi/
# or
$HOME/.config/novelfabric/pi/
```

They may materialize bundled settings, prompts, skills, and extensions such as sandbox/path guards, permission gates, and CLI-only write tools. Web-safe policy must default-deny raw `bash`, raw `write`, raw `edit`, arbitrary network, and arbitrary path access.

## 8. Agent / Skill Commands

```bash
novelfabric agents list --workspace <workspace> --json
novelfabric agents inspect --workspace <workspace> --agent <agent-id> --json
novelfabric agents materialize --workspace <workspace> --agent <agent-id> --kind role-agent --actor main_agent --json
novelfabric agents validate --workspace <workspace> --json

novelfabric skills list --workspace <workspace> --json
novelfabric skills read --workspace <workspace> --skill <skill-name> --json
novelfabric skills validate --workspace <workspace> --json
```

These commands inspect or materialize text constraints. They do not run LLM reasoning.

## 9. pi Agent SDK Boundary Commands

```bash
novelfabric agent task create --workspace <workspace> --kind <kind> --actor <actor> --context-pack <path> --json
novelfabric agent task inspect --workspace <workspace> --task <task-id> --json
novelfabric agent run --workspace <workspace> --task <task-id> --runtime pi --json
novelfabric agent output validate --workspace <workspace> --task <task-id> --json
novelfabric agent status --workspace <workspace> --task <task-id> --json
novelfabric agent abort --workspace <workspace> --task <task-id> --json
```

`agent run` uses the NovelFabric-wrapped pi agent SDK runtime. It must not route through a NovelFabric-owned provider adapter. Durable outputs should land as proposals and be applied by domain commands. The command must record runtime config root, enabled extensions, tool policy, actor, task id, session id, and output artifact paths.

Recommended task package:

```text
.novelfabric/tasks/<task-id>/
  task.md
  input.json
  context-pack.json
  allowed-commands.md
  output.schema.json
  result.json
  events.jsonl
```

## 10. Import / Chapterize Commands

```bash
novelfabric import inbox --workspace <workspace> --json
novelfabric import add --workspace <workspace> --from <local-file> --actor <actor> --json
novelfabric import normalize --workspace <workspace> --source imports/source/<file> --actor <actor> --json
novelfabric import chunk --workspace <workspace> --source imports/source/<file> --json
novelfabric import chapterize --workspace <workspace> --source imports/source/<file> --json
novelfabric import context-pack --workspace <workspace> --source imports/source/<file> --json
novelfabric import validate --workspace <workspace> --source imports/source/<file> --json
novelfabric import extraction apply --workspace <workspace> --proposal <path> --actor <actor> --json
```

`normalize`, `chunk`, and basic `chapterize` are deterministic. Semantic extraction is produced by pi agent skills and applied through `import extraction apply` or cards commands.

## 11. Cards / Memory Commands

```bash
novelfabric cards list --workspace <workspace> --kind character --json
novelfabric cards read --workspace <workspace> --path cards/characters/<id>.md --json
novelfabric cards propose --workspace <workspace> --context-pack <path> --actor <actor> --json
novelfabric cards validate --workspace <workspace> --proposal <path> --json
novelfabric cards apply --workspace <workspace> --proposal <path> --actor <actor> --json

novelfabric memory recall --workspace <workspace> --actor <actor> --profile <profile> --query <text> --json
novelfabric memory append --workspace <workspace> --actor <actor> --profile <profile> --stdin --json
novelfabric memory propose-shared --workspace <workspace> --actor <actor> --stdin --json
novelfabric memory apply-proposal --workspace <workspace> --proposal <path> --actor main_agent --json
```

Card and memory apply commands must validate citations before writing.

## 12. Knowledge / StoryRAG Commands

```bash
novelfabric knowledge sources list --workspace <workspace> --json
novelfabric knowledge rebuild --workspace <workspace> --actor <actor> --json
novelfabric knowledge validate --workspace <workspace> --json
novelfabric knowledge graph nodes --workspace <workspace> --json
novelfabric knowledge graph edges --workspace <workspace> --json
novelfabric knowledge graph episodes --workspace <workspace> --json

novelfabric recall quick --workspace <workspace> --query <text> --json
novelfabric recall panorama --workspace <workspace> --query <text> --timeline main --json
novelfabric recall insight --workspace <workspace> --query <text> --json
novelfabric context-pack build --workspace <workspace> --kind role-turn --agent <agent-id> --session <session-id> --json
novelfabric context-pack validate --workspace <workspace> --path <path> --json
```

Indexes under `knowledge/` are derived artifacts and must be rebuildable from source files.

## 13. Simulation / StorySwarm Commands

```bash
novelfabric simulation session create --workspace <workspace> --objective <text> --timeline main --actor main_agent --json
novelfabric simulation session inspect --workspace <workspace> --session <id> --json
novelfabric simulation context-pack --workspace <workspace> --session <id> --agent <agent-id> --json
novelfabric simulation append-turn --workspace <workspace> --session <id> --proposal <path> --actor <actor> --json
novelfabric simulation validate --workspace <workspace> --session <id> --json
novelfabric simulation report --workspace <workspace> --session <id> --json

novelfabric swarm plan --workspace <workspace> --session <id> --round <n> --json
novelfabric swarm task create --workspace <workspace> --session <id> --round <n> --agent <agent-id> --json
novelfabric swarm output validate --workspace <workspace> --artifact <path> --json
novelfabric swarm output apply --workspace <workspace> --artifact <path> --actor <actor> --json
novelfabric swarm round finalize --workspace <workspace> --session <id> --round <n> --json
```

Default round order is:

```text
characters -> random-event -> world-maintainer -> kp -> project-auditor
```

The semantic output comes from pi agent skills; CLI validates and applies.

## 14. Report / Writing Commands

```bash
novelfabric report task create --workspace <workspace> --session <id> --kind consistency --json
novelfabric report validate --workspace <workspace> --artifact <path> --json
novelfabric report apply --workspace <workspace> --artifact <path> --actor <actor> --json
novelfabric report list --workspace <workspace> --json
novelfabric report show --workspace <workspace> --path <path> --json

novelfabric writing context-pack --workspace <workspace> --session <id> --json
novelfabric writing draft --workspace <workspace> --context-pack <path> --actor <actor> --json
novelfabric writing apply-draft --workspace <workspace> --draft <path> --actor <actor> --json
novelfabric writing review --workspace <workspace> --chapter <path> --json
novelfabric writing export --workspace <workspace> --format markdown --json
```

`writing draft` creates or invokes a pi agent task. `apply-draft` is deterministic and audited.

## 15. Workflow Wrapper Commands

Workflow commands compose the domain commands above; they must not create a second business runtime.

```bash
novelfabric workflow plan --workspace <workspace> --source imports/source/<file> --role <role> --json
novelfabric workflow start --workspace <workspace> --plan <plan-id> --actor main_agent --json
novelfabric workflow peek --workspace <workspace> --job <job-id> --json
novelfabric workflow step --workspace <workspace> --job <job-id> --input <json> --json
novelfabric workflow status --workspace <workspace> --job <job-id> --json
novelfabric workflow resume --workspace <workspace> --job <job-id> --json
novelfabric workflow retry --workspace <workspace> --job <job-id> --stage <stage> --json
novelfabric workflow cancel --workspace <workspace> --job <job-id> --json
novelfabric workflow artifacts --workspace <workspace> --job <job-id> --json
novelfabric workflow verify --workspace <workspace> --job <job-id> --json
```

Recommended job files:

```text
.novelfabric/jobs/<job-id>/job.json
.novelfabric/jobs/<job-id>/state.json
.novelfabric/jobs/<job-id>/trace.jsonl
.novelfabric/jobs/<job-id>/artifacts.json
```

## 16. External Swarm Compatibility Commands

```bash
novelfabric external-swarm infer --workspace <workspace> --actor <actor> --request <request.json> --json
novelfabric external-swarm get --workspace <workspace> --actor <actor> --inference-id <id> --json
novelfabric external-swarm require-context --workspace <workspace> --actor <actor> --request <request.json> --json
novelfabric external-swarm validate --workspace <workspace> --actor <actor> --inference-id <id> --json
```

These commands must preserve the frozen REST/MCP response shape for:

```text
POST /api/external/swarm-inferences
GET /api/external/swarm-inferences/{inference_id}
POST /mcp
external_swarm_infer
external_swarm_require_context
external_swarm_get
```

## 17. Web Bridge Rule

Web routes should be thin adapters over the same command/service layer. A browser feature is incomplete until its equivalent CLI command exists.

Future bridge groups:

```text
/api/bridge/files/*
/api/bridge/runtime/*
/api/bridge/workflow/*
/api/bridge/agent/*
/api/bridge/context-pack/*
```

Web bridge runtime routes must apply the Web-safe pi policy: NovelFabric config root, bundled/approved extensions, actor-bound capabilities, and no raw dangerous tools for nontechnical sessions.

No Web route may write files directly or run semantic generation without pi agent SDK/task evidence.
