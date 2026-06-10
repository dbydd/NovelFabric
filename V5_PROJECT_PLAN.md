# NovelFabric V5 项目规划文档

状态：进行中
目标：将 NovelFabric V5 收束为基于 agent workspace + skill 注入 + Rust 工具的极简重构方案，并把关键决策与问答全过程落盘。

## 1. 当前已确认共识

### 1.1 V5 总方向

- 完全放弃 WebUI 作为产品主线。
- V5 主体是 agent workspace，不是传统前后端应用。
- 一切能写进 `AGENTS.md`、`SOUL.md`、skill、模板、约束文件的内容，不写成代码。
- 代码主要聚焦 Rust 工具；编排、角色行为、推演策略交给 agent + 文本约束。
- 工作区格式遵循 Pi 风格，可嵌套。
- 不再自建 StorySwarm/集群推演 runtime。
- MiroFish 属于后续可选附加能力，不是当前项目重点；未来如接入，优先以外部 skill 注入，而不是本体内建能力。
- 一切事实以文件为准，尽量为文本文件；派生产物允许重建，不能成为唯一真相源。
- 模板体系是 V5 的一等公民，内置于 `./templates`。

### 1.2 通过 planner / reviewer 得出的第一轮收束

- V5 最小产品更像 workspace harness，而不是小说平台完整 runtime。
- 旧文档中的 Web、HTTP API、internal swarm、StoryGraph/StoryRAG/ReportAgent 内建实现假设，若不显式废弃，会强烈污染 V5。
- 当前仓库根目录缺少 active 的根级 `AGENTS.md` / `PROJECT.md` / `README.md` 等入口，后续必须重建，否则 agent 入口会失效。
- 需要先写新的 superseding V5 文档，明确哪些历史文档继承、哪些废弃、哪些仅作参考。

## 2. 第一轮已确认决策

用户已明确确认：

- 采用 `Workspace Only` 边界：V5 只做工作区模板、约束文件、Rust 工具，不做 NovelFabric 自有 runtime、WebUI、长驻服务。
- 采用 `clean break`：V2/V4 的 Web、HTTP API、internal swarm、旧兼容承诺默认废弃，只保留历史文档作参考。
- MiroFish 不作为当前本体目标；后续若要接入，优先以外部 skill 注入，不抢占当前设计主线。
- 默认工作区形态不是 `projects/*` 管理器，而是“每个模板 fork 出来就是一个独立工作区/项目仓库”。
- 即便存在创建/管理命令，它也更接近一个辅助 CLI 或 skill，而不是产品本体。

## 2.1 第一轮后保留的建议默认值

这些点仍未被用户最终确认，暂作为建议：

- 模板首发先收敛到极少集合，再逐步扩充。
- Rust 工具面尽量收窄，优先保留能帮助 agent 管理文件与模板的原语。
- 工作区内的管理动作，应优先能被 skill 调用，而不是强绑定到单一 NovelFabric 专用交互壳。

## 3. V5 最小产品边界

已确认边界：

- 负责工作区初始化、模板铺设、受保护写入、审计、上下文打包、提案应用。
- 不负责内建小说推演 runtime。
- 不负责内建 WebUI。
- 不负责内建 StoryGraph / StoryRAG / ReportAgent 服务化实现。
- 允许未来通过 workspace skill 调用外部能力，例如 MiroFish，但这不属于当前首阶段本体范围。

## 4. 候选工作区契约

当前倾向已明确：

- 单个模板 fork 出来后，就是一个独立工作区。
- 不把 `projects/*` 多项目管理器作为默认根形态。
- 若后续提供 `novelfabric new --template ...` 之类命令，它更像模板分发/工作区生成工具，而不是产品主系统。
- 同样的创建与管理动作，也允许通过 skill 方式放进 `~/.agents/skills` 或局部 skill 目录，让 agent 代为执行。

### 4.1 单工作区候选结构

- `AGENTS.md`：根级约束与继承入口
- `SOUL.md`：根级身份/意图/方法论
- `.agents/skills/`：工作区本地 skills
- `.agents/mcp/`：工作区本地 adapter / MCP 配置覆盖
- `.pi/`：Pi 系统/上下文/计划元数据
- `canon/`：人物卡、规则卡、世界观、章节、时间线等规范文本
- `artifacts/`：派生产物、审计、提案、外部能力回填结果
- `inbox/`：导入但未规范化的原始材料
- 可选 `template.meta.json` 或等价模板元信息文件：描述模板来源、版本、变量与继承关系

## 5. Rust 工具最小面候选

当前方向：Rust 工具只保留与模板、文件管理、受保护写入、上下文打包有关的最小原语；不提前为 MiroFish、StoryGraph、StoryRAG、StorySwarm 写专门内建面。

候选工具：

- `workspace`：初始化 / 校验 / 诊断工作区结构
- `templates`：列出并应用内置模板，以及未来对接用户模板目录
- `guard`：安全 patch/write/rename，保护关键路径，写入审计
- `pack`：按角色/范围打上下文包
- `apply`：对提案进行校验并写回 canon 文件
- 可选极薄 `new`/`init` 入口：把模板 fork 到指定路径，但这也可以退化成 skill 行为，而不是必须的产品核心命令

## 6. 与历史文档的主要冲突

- `archived_docs/PRODUCT_SPEC.md` 仍然把产品定义为 Web 部署、前后端分离、Vue 前端，这与 V5 当前目标冲突。
- `archived_docs/docs/architecture/story-swarm-runtime.md` 假定 NovelFabric 自己维护推演主循环，与“复用外部 MiroFish”冲突。
- `archived_docs/docs/architecture/implementation-roadmap-story-systems.md` 预设后端模块与 HTTP API，与“只写工具、编排交给 agent”冲突。
- 多份历史文档仍使用 active/canonical 语气，但当前仓库根目录已经不是它们假定的结构。

## 7. Active 文档与模板落盘进度

### 7.1 已落盘的 active 根级文档

- `AGENTS.md`
- `PROJECT.md`
- `README.md`
- `SOUL.md`
- `V5_PROJECT_PLAN.md`

### 7.2 已落盘的 active 架构文档

- `docs/architecture/v5-boundary.md`
- `docs/architecture/v5-workspace-contract.md`
- `docs/architecture/v5-builtins-vs-adapters.md`
- `docs/architecture/v5-mirofish-adapter.md`
- `docs/architecture/v5-rust-tool-surface.md`
- `docs/architecture/v5-template-spec.md`
- `docs/architecture/v5-template-json-schema.md`
- `docs/architecture/v5-command-contract.md`
- `docs/architecture/v5-inheritance-matrix.md`

### 7.3 已落盘的首发模板骨架

- `templates/blank-root`
- `templates/novel-basic`
- `templates/tooling-only`
- `templates/analysis-research`

以上 4 个模板当前都已满足首阶段强制项：

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `template.json`

### 7.4 当前仍未实现

- `pack` 的 scope 解析虽然已增强，并已支持 `agents` / `skills` / `template` 一类工作区级 scope，但仍不是完整的 agent 级工作区理解
- `guard` 虽已支持 `--message` 轻量门禁（非空、单行、长度限制），但还没真正读取 few-shot 文件并做更语义化的 message 合规检查

### 7.5 已完成的代码进展

- 已初始化 Rust 工程 `novelfabric`
- 已实现单二进制 CLI 入口
- 已实现 `new` 子命令的最小可用版本
- 已实现 `guard` 子命令的最小可用版本
- 已实现 `pack` 子命令的最小可用版本
- `new` 已支持：模板发现、`template.json` 加载、变量默认值合并、文本替换、文件/目录重命名、`git init + 初始提交`、`--var KEY=VALUE` 调用方传值
- `guard` 已支持：读取 `template.json`、git 脏工作树失败、`protectList` 匹配、structured patch、受保护文件更新后单次自动提交、由调用方 agent 通过 `--message` 注入 commit message
- `pack` 已支持：`workspace + scope` 输入、scope 推断匹配、文本文件顺序拼接、优先写入 `artifacts/pack-<scope>.md`，不存在 `artifacts/` 时回退 stdout
- `pack` 的 scope 解析已增强为带优先级的规则：目录命中 > 文件名命中 > 文件 stem 命中 > 工作区定义文件补充 > 路径包含
- 已在模板内新增 agent-facing few-shot / conventions 文件，例如 `COMMIT_MESSAGE_FEWSHOT.md` 与 `PACK_SCOPE_CONVENTIONS.md`
- 已补齐集成测试：`new` 成功、`new --var` 覆盖、`new` 非空目录失败、`guard` dirty tree 失败、`guard` 非受保护文件失败、`guard` old_text 缺失失败、`guard` old_text 歧义失败、`guard --message` 轻量门禁、`guard` patch 成功并提交、`pack` 生成 artifacts 输出、`pack agents` scope 行为
- 已单独落盘 agent⇄CLI 协议文档：`docs/architecture/v5-agent-cli-protocol.md`
- 已明确第二阶段模型：agent 先进入工作区、读取约束文件，再主动调用 `novelfabric` CLI；CLI 不主动再去调 agent

## 8. 第一轮结论与第二轮待决问题

### 8.1 第一轮结论

1. V5 只包含“工作区模板 + 约束文件 + Rust 工具”，不包含 NovelFabric 自有 runtime / WebUI / 长驻服务。
2. V5 按 clean break 处理，默认废弃 V2/V4 的 Web、HTTP API、internal swarm、旧 MCP 兼容承诺。
3. MiroFish 不是当前项目重点；后续如接入，以外部 skill 注入为主。
4. 默认根形态采用单工作区模型：单个模板 fork 出来就是一个工作区/项目仓库。
5. 模板创建/管理动作可以有辅助 CLI，但也允许退化为 skill；不应把它膨胀为产品本体。

### 8.2 第二轮进展与待决问题

已确认：

1. 单工作区模板的最小目录骨架采用 `Loose Optional`，即不强制每个模板都包含 `canon/`、`artifacts/`、`inbox/`；目录结构由模板自身定义。

仍待明确：

2. `AGENTS.md`、`SOUL.md`、`.agents/skills/`、`.pi/` 在模板里的强制级别已确认：
- `AGENTS.md` 强制。
- `SOUL.md` 强制。
- `.agents/skills/` 强制。
- `.pi/` 可选。
- 上述文件/目录允许在子目录中嵌套存在，用于对子目录范围内的 subagent 继续注入局部约束、角色设定与技能能力。
- 但整体规范不应定得过死，应保留模板作者利用大模型自觉能力进行轻量发挥的空间。
3. 用户模板源规范：当前确认 `Later`，即首阶段先只做仓库内置模板，不急着定 `~/.config/novelfabric/templates/<name>/` 或 `user:xxx` 命名空间。
4. 首发内置模板已确认 4 个：`blank-root`、`novel-basic`、`tooling-only`、`analysis-research`。
5. Rust 工具首阶段已确认：内建 `new/init`、`guard/apply`、`pack`；不把 `validate` 作为当前必须首发命令。
6. 当某个动作既能做成 Rust 命令，也能做成 skill 时，默认倾向 `Prefer Skill`：先写成 skill；只有确实需要稳定、底层、可复用原语时，才下沉成 Rust 工具。
7. `pack` 首阶段输出形式已确认：先只产出单个 markdown/context 文件，优先服务 agent 直接读取。
8. `guard/apply` 首阶段采用 `protect list` 思路，但不设全局默认保护集合；`protect list` 完全由每个模板自行声明。
9. 额外强约束：每个模板实例都应是一个 git 仓库；凡是 `protect list` 内文件发生更新，都必须自动 commit，以保证变更可追溯、可重现、可回滚。
10. 首发模板必须带一个模板元信息文件，文件名已确认定为 `template.json`。
11. `template.json` 首阶段强制必填字段已确认：`name`、`description`、`protectList`。
12. `protectList` 首阶段同时支持相对路径与 glob 两种表达方式。
13. 模板变量替换首阶段采用 `Simple KV`，即只支持简单 key-value 变量替换，不引入重型类型系统。
14. `template.json` 继续作为 Rust 工具与 skill 统一读取模板规范的入口。
15. 模板变量替换首阶段默认作用域已确认：`Text Files`，即默认替换文本文件内容以及文件/目录名，不处理二进制文件。
16. `protect list` 内文件更新时，自动 commit 粒度已确认：`Per Apply`，即每次一次 `guard/apply` 事务结束后统一提交一次，并在提交信息中列出受影响文件。
17. `pack` 首阶段虽然输出单个 markdown，但其章节结构不由 Rust 工具硬编码；markdown 的组织方式尽量交给 agent、模板约束和相关 subagent 的 `AGENTS.md` 来决定。
18. `new/init` 生成工作区时，默认执行 `git init` 并创建首次提交，为后续 protect-list 自动提交机制提供基础。

## 9. 交互式问答记录

### Round 1

用户回答：

- 关于产品边界：确认采用 `Workspace Only`，即 V5 只做工作区模板、约束文件、Rust 工具；不做 NovelFabric 自有 runtime、WebUI、长驻服务。
- 关于兼容策略：确认采用 `clean break`，V2/V4 的 Web、HTTP API、internal swarm、旧兼容承诺默认废弃。
- 关于 MiroFish：明确表示这不是当前项目重点，而是附加功能；未来由用户自己调，以外部 skill 形式注入，本体暂不围绕它设计。
- 关于工作区形态：不采用 `projects/*` 管理器；更倾向“单个模板 fork 出来就是一个工作区/单项目仓库”。
- 关于管理命令：像 `novelfabric new --template user:xxx` 这种命令即便存在，也更像辅助管理工具；甚至这类动作也可以完全由 skill 放进 `~/.agents/skills` 或局部 skill 目录来代办。

### Round 2

用户回答：

- 关于模板目录骨架：确认采用 `Loose Optional`，即不强制每个模板都包含 `canon/`、`artifacts/`、`inbox/`；目录结构交由模板作者决定。
- 关于根级强制文件：用户选择进入自由讨论，希望先把“哪些文件必须存在”这件事讨论清楚，而不是直接勾选固定集合。
- 用户最终确认：`AGENTS.md`、`SOUL.md`、`.agents/skills/` 都强制；`.pi/` 可选。
- 用户明确强调：这些文件/目录本身也允许嵌套存在，可以在各个子目录下再放一份，给对应 subagent 做更局部的角色扮演与约束注入。
- 用户同时提醒：基于工作区的 agent harness 不要规定得太死，应承认大模型具备较强自觉能力，模板规范应留出灵活性。

### Round 3

用户回答：

- 关于用户模板源规范：确认采用 `Later`，即首阶段先只做仓库内置模板，不急着固定用户模板目录和 `user:xxx` 命名空间。
- 关于首发内置模板集合：确认首发内置模板为 4 个：`blank-root`、`novel-basic`、`tooling-only`、`analysis-research`。

### Round 4

用户回答：

- 关于 Rust 工具首阶段必须内建的命令：确认保留 `new/init`、`guard/apply`、`pack`。
- 用户没有把 `validate` 选为首阶段必须命令，意味着结构校验/模板完整性检查当前不作为最小首发硬要求。
- 关于“Rust 工具 vs skill”的优先级：确认采用 `Prefer Skill`，即默认先写成 skill；只有确实需要稳定、底层、可复用原语时，才下沉成 Rust 工具。

### Round 5

用户回答：

- 关于 `pack` 首阶段输出形式：确认采用 `Single Markdown`，即先只输出单个 markdown/context 文件，优先服务 agent 直接读取。
- 关于 `guard/apply` 保护范围：用户最终选择 `Template Decides`，即不设全局默认 protect list，完全由每个模板自己声明。
- 新增强约束：每个模板实例都要做成 git 仓库；凡是 `protect list` 内文件发生更新，都必须自动 commit，以保证更新可重现。
- 这意味着 `guard/apply` 不只是“保护写入”，还隐含“强审计 + 强版本留痕 + 回滚基础设施”的职责。

### Round 6

用户回答：

- 关于模板元信息文件：确认采用 `Yes Required`，即首发模板必须带一个模板元信息文件。
- 该元信息文件将作为模板规范的统一读取入口，用于声明模板名、描述、变量、`protect list` 等核心信息。
- 这也使得“模板自己决定 protect list”与“Rust 工具/skill 统一读取模板规范”两件事能够兼容。

### Round 7

用户回答：

- 关于模板元信息文件名：确认采用 `template.json`。
- 关于元信息必填字段：确认 `name`、`description`、`protectList` 为强制字段；`variables` 不是必填。
- 关于 `protect list` 表达方式：确认采用 `Both`，即同时支持相对路径和 glob。
- 关于模板变量系统：确认采用 `Simple KV`，即首阶段只支持简单 key-value 变量替换。

### Round 8

用户回答：

- 关于模板变量替换默认作用域：确认采用 `Text Files`，即默认替换文本文件内容以及文件/目录名，不处理二进制文件。
- 关于 `protect list` 自动 commit 粒度：确认采用 `Per Apply`，即每次一次 `guard/apply` 事务结束后统一提交一次，而不是每个文件单独提交。

### Round 9

用户回答：

- 关于 `pack` 输出 markdown 结构：不希望由 Rust 工具硬编码章节结构；markdown 相关组织应全部交给 agent 去写，约束写进模板和相关 subagent 的 `AGENTS.md`。
- 关于 `new/init` 的 git 初始化行为：确认采用 `Yes Default`，即生成工作区时默认 `git init` 并创建首次提交。

### Round 10

用户回答：

- 关于 `guard/apply` 自动 commit message：确认采用 `Template Driven`，即提交信息规则由模板声明，而不是工具写死固定前缀。
- 关于 `pack` 默认落点：初始倾向是 `Artifacts Dir`。

### Round 11

用户回答：

- 关于 artifacts 路径声明：不希望再为 `pack` 强行增加一个显式路径字段；用户倾向把 `pack` 视为更接近 LLM/agent 的能力，让它自己去理解工作区并寻找合适落点。
- 这意味着首阶段不新增 `artifactsPath` 之类的强制模板字段，继续保持“少 schema、多模板自治”的方向。

### Round 12

用户回答：

- 关于 `guard/apply` 的自动 commit message：不希望在 `template.json` 里再设计结构化字段、固定前缀或格式串。
- 用户倾向把 commit message 生成也交给 agent，用纯文本约束和 few-shot example 来指导专门写 commit message 的 agent。
- 这意味着首阶段不新增 `commitPrefix`、`commitMessageTemplate` 之类的 schema 字段，继续保持“少 schema、多文本约束”的总体方向。

### Round 13

用户回答：

- 关于阶段推进：当前不转入 Rust 实现，继续把实现逻辑和命令语义讨论细，一步到位后再写代码。
- 关于 `new/init` 目标路径已有内容时的默认行为：确认采用 `Fail Fast`，即目标路径非空就直接失败，避免误覆盖。
- 关于模板变量缺失时的默认行为：确认采用 `Template Default`，即优先使用模板里提供的默认值。

### Round 14

用户回答：

- 关于 `template.json` 里 `variables` 的首阶段表达方式：确认采用 `KV Defaults`。
- 也就是 `variables` 直接表示默认值映射；调用方传入的值覆盖模板默认值。
- 这保持了变量系统的轻量化，不引入对象层级和重型类型系统。

### Round 15

用户回答：

- 关于 `guard/apply` 运行时遇到 git 脏工作树的默认行为：确认采用 `Fail If Dirty`。
- 即只要工作区存在未提交改动，就直接失败，要求先整理现场。
- 不采用自动 stash，也不采用“无关改动继续”的更复杂逻辑。

### Round 16

用户回答：

- 关于 `protectList` 中一个文件被多条规则同时匹配时的处理方式：确认采用 `Allow`。
- 即多规则匹配到同一文件时不认为是冲突，正常 apply。
- 不采用阻塞或报告后继续的模式。

### Round 17

用户回答：

- 关于首阶段 Rust 工程的模块边界：确认采用 `Single File First`。
- 即先集中在少量文件里把完整逻辑写通，再考虑后续拆分，而不是一开始就做多层抽象。
- 这与此前“不要过早把逻辑拆散，先一步到位写完整”的偏好一致。

### Round 18

用户回答：

- 关于首阶段 Rust 命令的错误输出风格：确认采用 `Human First`。
- 即默认输出给人读的清晰错误信息，不把 JSON-first 作为当前优先方向。
- 这与当前项目“文本优先、约束优先、人类和 agent 都直接读文本”的总方向一致。

### Round 19

用户回答：

- 关于首阶段命令接口风格：确认采用 `One Binary`。
- 即使用一个 `novelfabric` 二进制，在其下挂 `new/init`、`guard/apply`、`pack` 这类子命令，而不是拆成多个独立小命令。
- 这意味着后续 CLI 壳应统一入口，内部再分发到具体命令逻辑。

### Round 20

用户回答：

- 关于单二进制下模板生成动作的命名：确认采用 `new Only`。
- 即只保留 `novelfabric new` 作为 canonical 子命令，不保留 `init` 作为并列主命令。
- 这会让 help 文案、文档引用和实现入口保持更统一。

### Round 21

用户回答：

- 关于 `guard/apply` 首阶段输入格式：确认采用 `Structured Patch`。
- 即吃结构化 patch 输入（目标文件 + old/new 片段），而不是整个文件替换或外挂 diff 文件。
- 这更符合受保护修改的定位，也让后续审计和自动 commit 更有数据基础。

### Round 22

用户回答：

- 关于 `pack` 首阶段输入类型：确认采用 `Range Only`。
- 即不吃显式文件路径列表，而是接受范围/角色标签，由工具或 agent 推断哪些文件属于该范围。
- 关于 `pack` 输出顺序策略：确认采用 `Sequential`。
- 即按范围定义隐含的文件顺序依次拼接，不做自动重排序。

## 10. 当前阶段性结论

当前已经从“高层重构讨论”推进到“active 文档集 + 首发模板骨架 + Rust 命令最小可用实现”阶段。

用户最新阶段选择：

- 暂不转入 Rust 代码实现。
- 继续收细节，不追求“再最小”的 MVP，而是尽量把实现逻辑、命令语义、内部模块边界和错误语义讨论清楚，一步到位后再写代码。

现阶段已经足以作为新的 active source of truth 的内容包括：

- V5 的 `Workspace Only` / `clean break` 边界
- 单模板即单工作区模型
- 首发模板集合
- `template.json` 基础规范
- `new/init`、`guard/apply`、`pack` 的最小命令契约
- `protectList` 模板自治 + `Per Apply` 自动提交原则
- MiroFish 的后置、外部、skill 注入定位

当前仍值得继续细化、但已经从“架构边界问题”下降到“命令与实现细节问题”的内容主要只剩：

- `new`、`guard/apply`、`pack` 的输入/输出与失败语义进一步写死
- `guard/apply` 结构化 patch 形状
- `guard/apply` 与 `pack` 的调用方式
