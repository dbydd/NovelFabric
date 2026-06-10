# NovelFabric v2 产品规格补充

> 本文档是对 `PRODUCT_SPEC.md` 的 v2 方向补充与收束。
> 目标不是推翻 v1，而是把其中关于“agent 后端如何实现”的模糊地带明确化，并将 v2、v3 的边界切清楚。

---

## 1. 文档定位

`PRODUCT_SPEC.md` 更像 v1 的愿景与约束总纲。

`PRODUCT_SPEC_2.md` 用于回答以下问题：

1. v2 阶段，NovelFabric 的 agent 后端究竟要做成什么样？
2. 是否必须重度复用 Codex 作为 agent 执行后端？
3. 如果不需要完整系统权限，一个更轻量、更安全、更贴近小说创作场景的 agent 架构应该是什么样？
4. 哪些需求属于 v2，哪些需求应当顺延到 v3？

本文视为 v2 的实现指引文档。

---

## 2. 核心判断

### 2.1 v2 不必重度复用 Codex 作为完整 agent 后端

NovelFabric 的角色 agent 与通用 coding agent 有本质差异：

- coding agent 往往需要系统环境访问、命令执行、进程管理、依赖安装、复杂外部工具调用
- NovelFabric 的剧情角色 agent、kp、项目审核 agent、世界观维护 agent、作者 agent、审核 agent，绝大多数时候**并不需要接触系统环境**
- 它们真正需要的能力主要是：
  - 读取项目内文本
  - 搜索相关文本
  - 对文本做局部修改
  - 调用一小组受限技能
  - 在严格约束下生成下一步剧情/审稿/设定更新

因此：

> v2 阶段，NovelFabric 不应默认把每个角色 agent 做成一个拥有完整系统环境权限的 Codex 代理。

更合适的方向是：

> 用 Rust 后端自行实现一个“轻量、文件优先、技能受限”的 agent runtime，把 Codex/LLM provider 当作模型推理后端，而不是当作完整执行后端。

---

### 2.2 v2 的 agent 本质上是“受限文本智能体”

v2 中的 agent 应理解为：

- 有角色身份
- 有可维护的 soul.md
- 有独立记忆文件
- 有自己的 skill 清单
- 能基于项目状态和当前时间点做判断
- 但它的执行面被严格限制在**文本读取、搜索、补丁式写入、技能调用**范围内

也就是说，v2 agent 的执行模型应是：

```text
读取项目文本 -> 读取角色 soul/记忆 -> 读取可用 skill -> 基于受限上下文推理 -> 输出结构化行动 -> 应用到文本项目资源
```

而不是：

```text
获得完整 shell/系统访问 -> 任意运行命令 -> 任意操作系统
```

---

## 3. v2 架构原则

### 3.1 文件优先原则继续保持不变

v2 必须坚持：

- 一切项目内可变资源基于文本文件
- agent 状态也基于文本文件
- skill 定义也基于文本文件
- 审计日志也基于文本文件

建议的文件组织继续围绕现有目录扩展：

- `project.md`
- `cards/characters/*.md`
- `cards/rules/*.md`
- `cards/world/*.md`
- `memory/**`
- `timeline/**`
- `writing/**`
- `simulation/**`
- `agents/<agent-id>/soul.md`
- `agents/<agent-id>/memory.md`
- `agents/<agent-id>/skills/*.md`
- `agents/<agent-id>/profile.json`
- `agents/<agent-id>/audit/*.md` 或等价审计文本

---

### 3.2 skill-first，而不是 shell-first

v2 的 agent 不应默认拥有 shell。

agent 能力应通过 skill 暴露，而 skill 本身也要尽量收敛成少量、稳定、可审计的原语。

#### 最小基础 skill 集

v2 最小基础技能建议只有以下几类：

1. **read**
   - 读取指定文件
   - 读取指定目录下符合模式的文件
   - 读取某个时间点、某个角色、某类卡片的上下文

2. **glob/search**
   - 在项目文本内查找相关资源
   - 根据章节、角色、时间点、标签做文件定位

3. **patch/write**
   - 对已存在文本做受控局部修改
   - 创建新文本文件
   - 追加审计记录

4. **structured-think**
   - 并非外部系统能力，而是对模型输出格式的强约束
   - 例如要求输出：
     - 目标
     - 依据
     - 行动
     - 影响资源
     - 风险提示

#### 可选高层剧情 skill

除基础 skill 外，可以定义若干“领域技能”，但它们本质上仍然只是在组织文本读写：

- `character-decision`
- `kp-adjudicate`
- `world-update`
- `project-audit`
- `author-draft`
- `review-check`
- `memory-summarize`
- `timeline-branch-proposal`

这些 skill 的目的主要是：

- 保存角色的能力设定
- 规范不同 agent 的输出风格
- 固化其职责边界

而不是赋予任意系统级能力。

---

### 3.3 agent 不直接接触系统环境

v2 必须明确：

- agent 不直接拿到 shell
- agent 不直接访问操作系统进程
- agent 不直接安装依赖
- agent 不直接访问项目目录之外的路径
- agent 不直接读写任意网络资源

agent 只通过后端暴露的受限 skill 接口操作。

这会带来几个直接收益：

1. 安全边界清晰
2. agent 不容易把自己“整失忆”
3. agent 不容易越权修改不该碰的文件
4. 项目更易做审计、回滚、复盘
5. 更贴合 NovelFabric 的真实业务需求

---

## 4. v2 安全与一致性机制

### 4.1 失忆防护

要防止角色 agent 把自己整“失忆”，需要后端增加最小一致性保护。

建议机制：

1. **关键文件保护层**
   - `soul.md`
   - `memory.md`
   - 关键设定卡
   - 当前时间点关键记忆

   对这些文件的写入必须经过额外校验。

2. **写前快照**
   - 每次关键写入前，先保存旧版本快照到审计目录

3. **结构约束校验**
   - soul.md 不得被写成空文件
   - memory.md 不得整体清空
   - 核心卡片不得在无理由情况下删除关键章节/设定段落

4. **写后一致性检查**
   - 检测是否把角色姓名、身份、核心目标、关系网意外删除

---

### 4.2 OOC 防护

要防止角色 OOC（Out of Character），应提供一层“角色一致性检查”。

建议检查项：

- 是否违背 soul.md 中的核心人格约束
- 是否违背已有角色卡设定
- 是否与最近几轮角色记忆冲突
- 是否突然获得未解释的新知识
- 是否做出超出其身份边界的判断

建议输出分级：

- PASS：符合角色设定
- WARN：略有偏移，但可解释
- BLOCK：明显 OOC，不允许自动写回

---

### 4.3 世界观与规则一致性防护

除角色层面，还应有：

1. **规则卡一致性检查**
   - kp 裁定不得越过规则卡

2. **世界观一致性检查**
   - 新角色引入
   - 新地区设定
   - 新技术/资源/政治关系
   都要和世界观设定卡兼容

3. **时间线一致性检查**
   - 当前章节或推演结果不得直接篡改历史时间点
   - 若要改变，必须走 branch / rollback 机制

---

## 5. v2 agent runtime 设计

### 5.1 运行时最小模型

建议每个 agent 一次执行都采用统一输入：

- `agent_id`
- `soul.md`
- `memory.md`
- 可用 `skills/*.md`
- 当前任务说明
- 相关项目上下文（卡片/记忆/章节/时间点）

输出应是结构化对象，例如：

```json
{
  "intent": "character_decision",
  "reasoning_summary": "...",
  "actions": [
    {
      "type": "patch_file",
      "target": "memory/agents/...",
      "content": "..."
    }
  ],
  "consistency_checks": {
    "ooc": "PASS",
    "world": "PASS",
    "timeline": "WARN"
  }
}
```

然后由后端决定是否执行这些文本变更。

---

### 5.2 后端职责

Rust 后端在 v2 中承担：

- 项目文本资源管理
- agent 资产管理
- skill 注册与调度
- 安全检查与一致性检查
- 时间线/分叉约束
- 审计记录
- 模型协议兼容层（Responses / Anthropic / 其他）

后端不应把 agent 执行逻辑完全交给外部模型黑盒。

模型只负责：

- 在受限上下文下生成候选行动

后端负责：

- 决定是否允许写入
- 如何写入
- 写入后是否仍满足系统约束

---

## 6. 关于 `open-agent-sdk-rust` 的态度

参考库：
- [open-agent-sdk-rust](https://github.com/slb350/open-agent-sdk-rust)

### 6.1 可借鉴点

如果该库提供以下能力，可以考虑借用：

- agent 抽象
- tool/skill 调度接口
- 结构化消息流
- 多 provider 适配
- tracing / audit hooks

### 6.2 不应直接无脑照搬

NovelFabric 的特点决定了我们不能无脑引入一个通用 agent runtime：

- 我们的 agent 不是通用 autonomous agent
- 它们是**强角色约束、强文本约束、强时间线约束**的小说智能体
- 我们更需要：
  - 文件原语
  - 一致性校验
  - 分叉/回滚控制
  - 角色 OOC 防护

因此建议是：

> 可以把 `open-agent-sdk-rust` 作为可复用基础设施候选，但 v2 的主设计应由 NovelFabric 自己主导，围绕“文本项目 + 角色智能体 + 技能约束”定制，而不是被通用 SDK 反向塑形。

### 6.3 采纳原则

若要引入，必须满足：

1. 不破坏文本优先架构
2. 不强迫 agent 获得系统环境权限
3. 不弱化我们对 skill 边界的控制
4. 不阻碍时间线分叉与记忆一致性校验
5. 能在 Rust 内部被裁剪成受限 runtime

否则，宁可自己实现轻量版本。

---

## 7. v2 目标收束

v2 的核心目标应当收束为：

### 7.1 项目层
- 文本优先项目结构稳定
- 卡片/记忆/章节/时间线分叉流程稳定
- 可导入 txt 小说并形成基础资源

### 7.2 agent 层
- 每个角色/系统角色都有：
  - `soul.md`
  - `memory.md`
  - `skills/`
- agent 可通过受限 skill 进行文本读写
- agent 执行结果经过安全与一致性检查后落盘

### 7.3 推演层
- 角色决策
- 随机事件
- world maintainer
- kp
- project auditor
  这些角色能够通过统一 runtime 顺序执行

### 7.4 文书层
- 作者 agent 负责把推演结果整理成章节
- 审核 agent 检查：
  - 字数
  - 合规性
  - 与前文冲突
  - OOC 风险

### 7.5 技术层
- provider 兼容层至少支持：
  - OpenAI Responses
  - OpenAI Chat Completions
  - Anthropic Messages
- 但上层业务逻辑不直接依赖某个 provider 的独特格式

---

## 8. v3 规划

原 `PRODUCT_SPEC.md` 中的额外功能需求：

> 小说创作平台接入：一键将更新推送至番茄/刺猬猫等平台，可能涉及 api 逆向 / 网页自动化相关问题

应当从原先的“v2 额外功能需求”明确后移到 **v3**。

### 8.1 为什么放到 v3

原因：

1. 它不属于 NovelFabric 的核心创作引擎
2. 它强依赖外部平台协议与不稳定集成
3. 它可能涉及逆向、网页自动化、登录态维护等高变动工作
4. 在 agent runtime、推演闭环、文书闭环尚未稳定前，过早做平台发布会冲散主线

### 8.2 v3 目标

v3 再考虑：

- 番茄 / 刺猬猫 / 其它平台发布适配器
- 平台账号管理
- 上传队列与失败重试
- 网页自动化 / API 适配
- 发布前审校与格式转换

v3 的前提是：

> v2 已经把“项目内创作智能体系统”做扎实。

---

## 9. 最终结论

v2 的正确方向不是“把每个角色都做成一个完整 Codex shell agent”，而是：

> 用 Rust 后端实现一个轻量、文件优先、skill-first、强一致性约束的 agent runtime。

其最小基础能力只需要：

- read
- glob/search
- patch/write
- 少量角色领域 skill

再叠加：

- 失忆防护
- OOC 防护
- 规则/世界观一致性检查
- 时间线分叉与回滚约束

这条路线更轻、更安全、更贴合 NovelFabric 的真实需求，也更容易在 v2 做到可用。

而平台一键发布能力，明确归入 **v3**。
