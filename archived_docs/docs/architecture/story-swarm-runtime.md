# StorySwarm / ReportAgent 设计约束

> 用于约束 NovelFabric 后续的群体推演与报告 agent 开发。

---

## 1. 核心定位

StorySwarm 是 NovelFabric 的**小说世界群体推演层**。

它不是社交媒体模拟壳，不是 Twitter/Reddit clone，也不是通用 autonomous shell agent 群。

它的职责是：

- 基于角色卡、规则卡、世界观卡、记忆、章节、时间线
- 让多个角色与系统角色在统一 runtime 下进行一轮轮推演
- 把结果写回文本资源

---

## 2. 默认参与角色

### 2.1 角色 agents

来自人物卡或项目角色定义。

### 2.2 系统角色

固定至少包括：

- `random-event`
- `world-maintainer`
- `kp`
- `project-auditor`

后续文书阶段可再接：

- `author`
- `reviewer`

---

## 3. 默认轮次顺序

第一版固定为：

```text
characters -> random-event -> world-maintainer -> kp -> project-auditor
```

含义：

1. 各角色先提出行动
2. 随机事件注入扰动
3. 世界观维护者检查/补足环境变化
4. KP 依据规则卡裁定结果
5. 项目审核 agent 判断是否偏纲、是否收束本局

不要为了“更像 MiroFish”而把默认主循环改成社媒传播循环。

---

## 4. 每轮输入上下文

每个 agent 单次执行时，最少应看到：

- 自己的 `soul.md`
- 自己的 `memory.md` 或相关分层记忆
- 当前任务说明
- 当前 session 最近日志
- 当前 timepoint / timeline
- StoryRAG 提供的相关事实
- 对应角色卡 / 规则卡 / 世界观卡

禁止默认给予：

- shell
- 任意系统命令
- 任意项目外路径
- 任意网络写操作

---

## 5. 每轮输出格式

建议所有 agent 输出结构化结果，而不是直接自由文本写文件。

参考：

```json
{
  "agent_id": "aria",
  "intent": "character_decision",
  "reasoning_summary": "...",
  "evidence": [
    "cards/characters/aria.md",
    "memory/agents/aria/..."
  ],
  "actions": [
    {
      "type": "log_event",
      "summary": "Aria decides to ..."
    }
  ],
  "consistency_checks": {
    "ooc": "PASS",
    "world": "PASS",
    "timeline": "WARN"
  }
}
```

后端再决定是否落盘。

---

## 6. 必须做的一致性检查

### 6.1 OOC 检查

至少三档：

- `PASS`
- `WARN`
- `BLOCK`

检查依据：

- `soul.md`
- 角色卡
- 最近记忆
- 已知关系和目标

### 6.2 世界观检查

检查：

- 新设定是否与世界观卡冲突
- 新地点/组织/技术是否合理
- 新知识是否无来源获得

### 6.3 时间线检查

检查：

- 是否试图直接篡改历史时间点
- 是否需要 branch / rollback
- 是否与当前 branch 状态矛盾

### 6.4 规则检查

KP 裁定不得越过规则卡。

---

## 7. 每轮最小落盘要求

一次成功推进后，至少应落：

1. `simulation` log
2. agent memory 更新
3. 必要的 timepoint / branch 事件
4. 必要的 StoryGraph 增量信息
5. 审计记录

禁止只在内存里完成推演而不落文本。

---

## 8. ReportAgent 定位

ReportAgent 不是普通摘要器。

它应支持：

- 推演报告
- 角色采访总结
- 分支影响分析
- 一致性审计
- 续写建议
- 伏笔/冲突追踪

其上游数据来源：

- StoryRAG
- simulation logs
- memory
- timeline
- interview results

---

## 9. interview 能力的约束

采访对象可以是：

- 某个角色
- `kp`
- `world-maintainer`
- `project-auditor`
- `author`

采访回答必须尽量基于：

- 本角色记忆
- 当前局面
- 相关检索事实

不应变成无依据的泛聊。

---

## 10. 开发顺序约束

建议顺序：

1. 先把 StoryRAG 接入 simulation 上下文
2. 再做角色/系统角色结构化输出
3. 再做一致性检查
4. 再做 ReportAgent
5. 最后做 interview 与复杂分析

不要一上来做复杂多 agent UI，而后端没有统一可审计输出。
