<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  scaleOrdinal
} from "d3";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { z } from "zod";
import { insertWorkspaceFile, treeRowsForExpanded } from "./workspace-tree.js";

type FunctionId = "workspace" | "rag" | "swarm" | "chat" | "api";
type TabKind = "file" | "manager" | "rag-node";
type ResizeKind = "sidebar" | "inspector" | "chat" | "session";
type FileIconClass =
  | "icon-folder"
  | "icon-card"
  | "icon-agent"
  | "icon-simulation"
  | "icon-locked"
  | "icon-json"
  | "icon-character"
  | "icon-world"
  | "icon-report"
  | "icon-config"
  | "icon-markdown"
  | "icon-text";

type SidebarFunction = {
  readonly id: FunctionId;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
};

type WorkspaceNode = {
  readonly label: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly protected?: boolean;
  readonly children?: readonly WorkspaceNode[];
};

type WorkspaceTreeRow = {
  readonly node: WorkspaceNode;
  readonly depth: number;
};

type Tab = {
  readonly id: string;
  readonly label: string;
  readonly kind: TabKind;
  readonly target: string;
  readonly functionId: FunctionId;
  readonly locked?: boolean;
};

type FileDraftSource = "seed" | "bridge";

type FileDraft = {
  readonly original: string;
  readonly current: string;
  readonly baseHash: string | null;
  readonly dirty: boolean;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly locked: boolean;
  readonly error: string;
  readonly source: FileDraftSource;
  readonly lastSavedAuditPath: string | null;
};

type BridgeHealth = "unknown" | "live" | "offline-buffer";

type BridgeError = {
  readonly code: string;
  readonly message: string;
};

type FilePreview = {
  readonly path: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly evidence: string;
  readonly locked: boolean;
};

type RagNode = {
  readonly id: string;
  readonly label: string;
  readonly filePath: string;
  readonly kind: "character" | "world" | "memory" | "chapter" | "report";
  readonly x: number;
  readonly y: number;
  readonly summary: string;
  readonly related: readonly string[];
};

type RagEdge = {
  readonly from: string;
  readonly to: string;
  readonly label: string;
};

type ClusterSimNode = SimulationNodeDatum & {
  readonly id: string;
  readonly label: string;
  readonly filePath: string;
  readonly kind: RagNode["kind"];
  readonly summary: string;
  readonly related: readonly string[];
};

type ClusterSimLink = SimulationLinkDatum<ClusterSimNode> & {
  readonly id: string;
  readonly label: string;
};

type SwarmStage = {
  readonly index: number;
  readonly label: string;
  readonly output: string;
  readonly detail: string;
};

type AgentLane = {
  readonly id: string;
  readonly role: string;
  readonly capability: string;
  readonly status: string;
  readonly detail: string;
  readonly accent: "cyan" | "violet" | "green" | "amber";
};

type FrozenEndpoint = {
  readonly name: string;
  readonly detail: string;
  readonly fields: readonly string[];
};

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "agent";
  readonly author: string;
  readonly content: string;
  readonly meta: string;
};

type ImportUpload = {
  readonly fileName: string;
  readonly targetPath: string;
  readonly sizeLabel: string;
  readonly preview: string;
};

type DirectoryManagerKind =
  | "workspace"
  | "imports"
  | "source-inbox"
  | "cards"
  | "agents"
  | "simulation"
  | "reports"
  | "scaffold"
  | "files";

type DirectoryManager = {
  readonly path: string;
  readonly kind: DirectoryManagerKind;
  readonly title: string;
  readonly description: string;
};

type FileMode = "markdown" | "json" | "toml" | "text";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonPreviewKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "error";

type JsonPreviewRow = {
  readonly id: string;
  readonly depth: number;
  readonly label: string;
  readonly kind: JsonPreviewKind;
  readonly summary: string;
  readonly value: string;
};

type StatusTone = "ready" | "running" | "warning" | "locked";

type DashboardMetric = {
  readonly label: string;
  readonly value: string;
  readonly tone: StatusTone;
};

type ImportJob = {
  readonly fileName: string;
  readonly status: string;
  readonly encoding: string;
  readonly size: string;
  readonly progress: number;
  readonly targetPath: string;
  readonly chapters: number;
  readonly warning: string;
};

type ChapterPreview = {
  readonly title: string;
  readonly words: string;
  readonly characters: readonly string[];
  readonly location: string;
  readonly risk: string;
  readonly status: string;
};

type CardRecord = {
  readonly kind: "character" | "world" | "rule" | "scene";
  readonly name: string;
  readonly path: string;
  readonly evidence: string;
  readonly status: string;
  readonly updated: string;
};

type AgentAssetRecord = {
  readonly agent: string;
  readonly asset: string;
  readonly path: string;
  readonly protected: boolean;
  readonly capability: string;
  readonly lastUsed: string;
};

type SimulationTurnRecord = {
  readonly round: string;
  readonly actor: string;
  readonly action: string;
  readonly status: string;
  readonly artifact: string;
};

type ReportRecord = {
  readonly name: string;
  readonly type: string;
  readonly path: string;
  readonly risk: string;
  readonly citations: string;
  readonly status: string;
};

type ScaffoldRecord = {
  readonly name: string;
  readonly path: string;
  readonly status: string;
  readonly policy: string;
};

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

const sidebarFunctions: readonly SidebarFunction[] = [
  {
    id: "workspace",
    label: "文件管理",
    icon: "▤",
    description: "浏览项目文本、受保护资产与派生产物"
  },
  {
    id: "rag",
    label: "集群推演图谱",
    icon: "◎",
    description: "可视化智能体集群、关系与文件注入记忆"
  },
  {
    id: "swarm",
    label: "跑团推演",
    icon: "◌",
    description: "查看跑团式智能体集群阶段与 agent lane"
  },
  {
    id: "chat",
    label: "聊天 Buffer",
    icon: "✦",
    description: "网页端一等公民：通过聊天操作文件、推演和分镜"
  }
];

const initialWorkspaceTree: readonly WorkspaceNode[] = [
  {
    label: "workspace-novel",
    path: ".",
    kind: "directory",
    children: [
      { label: "project.md", path: "project.md", kind: "file" },
      { label: "project.json", path: "project.json", kind: "file" },
      {
        label: ".novelfabric",
        path: ".novelfabric",
        kind: "directory",
        children: [
          { label: "workspace.json", path: ".novelfabric/workspace.json", kind: "file" },
          {
            label: "template-manifest.json",
            path: ".novelfabric/template-manifest.json",
            kind: "file"
          },
          {
            label: "capabilities.toml",
            path: ".novelfabric/capabilities.toml",
            kind: "file",
            protected: true
          }
        ]
      },
      {
        label: "imports",
        path: "imports",
        kind: "directory",
        children: [
          {
            label: "source",
            path: "imports/source",
            kind: "directory",
            children: [
              {
                label: "gear-rain-fulltext.txt",
                path: "imports/source/gear-rain-fulltext.txt",
                kind: "file"
              },
              {
                label: "west-gate-outline.md",
                path: "imports/source/west-gate-outline.md",
                kind: "file"
              },
              { label: "old-draft-2.txt", path: "imports/source/old-draft-2.txt", kind: "file" }
            ]
          }
        ]
      },
      {
        label: "cards",
        path: "cards",
        kind: "directory",
        children: [
          {
            label: "characters",
            path: "cards/characters",
            kind: "directory",
            children: [{ label: "aria.md", path: "cards/characters/aria.md", kind: "file" }]
          },
          {
            label: "rules",
            path: "cards/rules",
            kind: "directory",
            children: [{ label: "oath-lock.md", path: "cards/rules/oath-lock.md", kind: "file" }]
          },
          {
            label: "scenes",
            path: "cards/scenes",
            kind: "directory",
            children: [
              { label: "west-gate-rain.md", path: "cards/scenes/west-gate-rain.md", kind: "file" }
            ]
          },
          {
            label: "world",
            path: "cards/world",
            kind: "directory",
            children: [
              { label: "clockwork-city.md", path: "cards/world/clockwork-city.md", kind: "file" }
            ]
          }
        ]
      },
      {
        label: "memory",
        path: "memory",
        kind: "directory",
        children: [
          { label: "global", path: "memory/global", kind: "directory" },
          { label: "agents", path: "memory/agents", kind: "directory" },
          { label: "branches", path: "memory/branches", kind: "directory" },
          { label: "chapters", path: "memory/chapters", kind: "directory" }
        ]
      },
      {
        label: "timeline",
        path: "timeline",
        kind: "directory",
        children: [
          { label: "index.json", path: "timeline/index.json", kind: "file" },
          { label: "branches", path: "timeline/branches", kind: "directory" }
        ]
      },
      {
        label: "writing",
        path: "writing",
        kind: "directory",
        children: [
          {
            label: "chapters",
            path: "writing/chapters",
            kind: "directory",
            children: [
              { label: "chapter-004.md", path: "writing/chapters/chapter-004.md", kind: "file" },
              {
                label: "import-preview.md",
                path: "writing/chapters/import-preview.md",
                kind: "file"
              },
              {
                label: "第二章 钟楼名单.md",
                path: "writing/chapters/第二章 钟楼名单.md",
                kind: "file"
              }
            ]
          },
          { label: "drafts", path: "writing/drafts", kind: "directory" },
          { label: "review-notes", path: "writing/review-notes", kind: "directory" },
          { label: "audit", path: "writing/audit", kind: "directory" }
        ]
      },
      {
        label: "simulation",
        path: "simulation",
        kind: "directory",
        children: [
          { label: "active-session.txt", path: "simulation/active-session.txt", kind: "file" },
          {
            label: "context-packs",
            path: "simulation/context-packs",
            kind: "directory",
            children: [
              {
                label: "west-gate-004.md",
                path: "simulation/context-packs/west-gate-004.md",
                kind: "file"
              }
            ]
          },
          { label: "logs", path: "simulation/logs", kind: "directory" },
          { label: "sessions", path: "simulation/sessions", kind: "directory" },
          {
            label: "turns",
            path: "simulation/turns",
            kind: "directory",
            children: [
              { label: "round-004.json", path: "simulation/turns/round-004.json", kind: "file" }
            ]
          }
        ]
      },
      {
        label: "agents",
        path: "agents",
        kind: "directory",
        children: [
          {
            label: "aria",
            path: "agents/aria",
            kind: "directory",
            children: [
              { label: "soul.md", path: "agents/aria/soul.md", kind: "file", protected: true }
            ]
          },
          {
            label: "kp",
            path: "agents/kp",
            kind: "directory",
            children: [
              { label: "memory.md", path: "agents/kp/memory.md", kind: "file", protected: true }
            ]
          },
          {
            label: "project-auditor",
            path: "agents/project-auditor",
            kind: "directory",
            children: [
              {
                label: "skills",
                path: "agents/project-auditor/skills",
                kind: "directory",
                children: [
                  {
                    label: "consistency-audit.md",
                    path: "agents/project-auditor/skills/consistency-audit.md",
                    kind: "file"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        label: "knowledge",
        path: "knowledge",
        kind: "directory",
        children: [
          { label: "chunks", path: "knowledge/chunks", kind: "directory" },
          { label: "graph", path: "knowledge/graph", kind: "directory" },
          { label: "indexes", path: "knowledge/indexes", kind: "directory" }
        ]
      },
      {
        label: "reports",
        path: "reports",
        kind: "directory",
        children: [
          { label: "branch-impact.md", path: "reports/branch-impact.md", kind: "file" },
          {
            label: "consistency-west-gate.md",
            path: "reports/consistency-west-gate.md",
            kind: "file"
          },
          { label: "import-summary.md", path: "reports/import-summary.md", kind: "file" }
        ]
      },
      { label: "history", path: "history", kind: "directory" }
    ]
  }
];

const previews: readonly FilePreview[] = [
  {
    path: "project.md",
    title: "项目概览：齿轮雨之城",
    body: [
      "主题：蒸汽朋克城市中的盟约、背叛与时间线分叉。",
      "当前目标：保持主线连续性，同时允许西门事件产生 branch-impact report。"
    ],
    evidence: "project.md · timeline/index.json",
    locked: false
  },
  {
    path: "imports/source",
    title: "原始拆书收件箱",
    body: [
      "未拆分的小说源文件进入 imports/source/。",
      "后续 CLI/agent 拆书流程从这里读取原文，再生成章节、卡片、记忆和报告。"
    ],
    evidence: "canonical workspace layout · imports/source/",
    locked: false
  },
  {
    path: "cards/characters/aria.md",
    title: "人物卡：Aria",
    body: [
      "核心欲望：找到钟楼雨幕背后的失踪者名单。",
      "限制：不得突然获得未由上下文授权的新知识。"
    ],
    evidence: "cards/characters/aria.md · agents/aria/soul.md",
    locked: false
  },
  {
    path: "cards/world/clockwork-city.md",
    title: "世界卡：Clockwork City",
    body: [
      "城市由七座钟楼维持季风节律。西门负责排放齿轮雨。",
      "任何时间线回退都必须留下 branch manifest。"
    ],
    evidence: "cards/world/clockwork-city.md",
    locked: false
  },
  {
    path: "agents/aria/soul.md",
    title: "受保护资产：Aria Soul",
    body: ["此文件属于受保护资产。写入必须经过 capability manifest 与 protected path checks。"],
    evidence: "agents/aria/soul.md · .novelfabric/capabilities.toml",
    locked: true
  },
  {
    path: "agents/kp/memory.md",
    title: "受保护资产：KP Memory",
    body: [
      "KP 记忆不允许被角色 subagent 直接改写。",
      "允许路径是 proposal → validation → promoted write。"
    ],
    evidence: "agents/kp/memory.md · agents/kp/audit/",
    locked: true
  },
  {
    path: "simulation/active-session.txt",
    title: "Active Session",
    body: [
      "session-west-gate-004",
      "当前轮：round-004，下一步：project-auditor consistency check。"
    ],
    evidence: "simulation/active-session.txt",
    locked: false
  },
  {
    path: "simulation/turns/round-004.json",
    title: "Round 004 Turn Record",
    body: [
      "aria: proposes opening west gate",
      "kp: requires oath rule",
      "auditor: flags timeline branch risk"
    ],
    evidence: "simulation/turns/round-004.json",
    locked: false
  },
  {
    path: "reports/branch-impact.md",
    title: "Branch Impact Report",
    body: [
      "西门事件若改写历史，需要从 tp-0007 创建 branch-west-gate。",
      "影响：Aria 记忆、钟楼世界卡、第四章草稿。"
    ],
    evidence: "reports/branch-impact.md · timeline/branches/branch-west-gate.json",
    locked: false
  },
  {
    path: ".novelfabric/capabilities.toml",
    title: "受保护配置：Capabilities",
    body: [
      "main agent: project.manage, report.render",
      "role agent: memory.recall, simulation.append_turn",
      "denied: files.patch_protected, external_swarm.run"
    ],
    evidence: ".novelfabric/capabilities.toml",
    locked: true
  }
];

const directoryManagers: readonly DirectoryManager[] = [
  {
    path: ".",
    kind: "workspace",
    title: "Workspace Control Center",
    description: "项目根目录工作台，集中呈现 layout 健康度、近期文件、保护策略和工作流状态。"
  },
  {
    path: "imports",
    kind: "imports",
    title: "Import Pipeline",
    description: "拆书流水线总览：源文件、章节切分、抽卡、记忆、报告的进度都在这里调度。"
  },
  {
    path: "imports/source",
    kind: "source-inbox",
    title: "Source Inbox",
    description: "原始小说文件收件箱。上传、编码检测、拆章策略和章节预览都在这个目录工作台完成。"
  },
  {
    path: "cards",
    kind: "cards",
    title: "Card Studio",
    description: "卡片与分镜工作台：人物、世界、规则、场景卡统一管理，并展示证据路径和一致性状态。"
  },
  {
    path: "agents",
    kind: "agents",
    title: "Agent Asset Console",
    description: "agent 资产工作台：soul、memory、skills、capability 与受保护写入状态集中管理。"
  },
  {
    path: "simulation",
    kind: "simulation",
    title: "Simulation Session Desk",
    description: "推演 session 工作台：当前轮次、agent lane、turn 记录和校验状态集中呈现。"
  },
  {
    path: "reports",
    kind: "reports",
    title: "Report & Artifact Center",
    description: "报告与产物工作台：分支影响、一致性审计、context pack、role reasoning 和导出状态。"
  },
  {
    path: ".novelfabric",
    kind: "scaffold",
    title: "Scaffold & Capability Console",
    description:
      "V4 scaffold 工作台：workspace manifest、capability policy、layout doctor 和模板版本。"
  }
];

const workspaceTree = ref<readonly WorkspaceNode[]>(initialWorkspaceTree);

const workspaceMetrics: readonly DashboardMetric[] = [
  { label: "Layout", value: "26/26", tone: "ready" },
  { label: "Protected", value: "4 files", tone: "locked" },
  { label: "Inbox", value: "imports/source", tone: "ready" },
  { label: "Bridge", value: "offline", tone: "warning" }
];

const importJobs: readonly ImportJob[] = [
  {
    fileName: "gear-rain-fulltext.txt",
    status: "ready to split",
    encoding: "UTF-8",
    size: "142 KB",
    progress: 68,
    targetPath: "imports/source/gear-rain-fulltext.txt",
    chapters: 18,
    warning: "2 ambiguous headings"
  },
  {
    fileName: "west-gate-outline.md",
    status: "chapterized",
    encoding: "UTF-8",
    size: "24 KB",
    progress: 100,
    targetPath: "imports/source/west-gate-outline.md",
    chapters: 6,
    warning: "ready for card extraction"
  },
  {
    fileName: "old-draft.txt",
    status: "needs rename",
    encoding: "GB18030 guessed",
    size: "96 KB",
    progress: 22,
    targetPath: "imports/source/old-draft-2.txt",
    chapters: 0,
    warning: "filename collision"
  }
];

const chapterPreviews: readonly ChapterPreview[] = [
  {
    title: "第一章 雨夜齿轮",
    words: "3.8k",
    characters: ["Aria", "KP"],
    location: "西门",
    risk: "low",
    status: "chapter draft"
  },
  {
    title: "第二章 钟楼名单",
    words: "4.1k",
    characters: ["Aria", "World Maintainer"],
    location: "第七钟楼",
    risk: "timeline branch",
    status: "needs audit"
  },
  {
    title: "第三章 锁孔誓约",
    words: "2.9k",
    characters: ["Aria", "Project Auditor"],
    location: "地下排雨渠",
    risk: "rule citation",
    status: "card evidence pending"
  }
];

const cardRecords: readonly CardRecord[] = [
  {
    kind: "character",
    name: "Aria",
    path: "cards/characters/aria.md",
    evidence: "agents/aria/soul.md",
    status: "consistent",
    updated: "round-004"
  },
  {
    kind: "world",
    name: "Clockwork City",
    path: "cards/world/clockwork-city.md",
    evidence: "timeline/index.json",
    status: "needs branch note",
    updated: "chapter-004"
  },
  {
    kind: "rule",
    name: "Oath Lock",
    path: "cards/rules/oath-lock.md",
    evidence: "simulation/turns/round-004.json",
    status: "missing citation",
    updated: "queued"
  },
  {
    kind: "scene",
    name: "West Gate Rain",
    path: "cards/scenes/west-gate-rain.md",
    evidence: "writing/chapters/chapter-004.md",
    status: "storyboard-ready",
    updated: "draft"
  }
];

const agentAssets: readonly AgentAssetRecord[] = [
  {
    agent: "aria",
    asset: "soul",
    path: "agents/aria/soul.md",
    protected: true,
    capability: "memory.recall",
    lastUsed: "context-pack-004"
  },
  {
    agent: "kp",
    asset: "memory",
    path: "agents/kp/memory.md",
    protected: true,
    capability: "validate-round",
    lastUsed: "round-004"
  },
  {
    agent: "project-auditor",
    asset: "skill",
    path: "agents/project-auditor/skills/consistency-audit.md",
    protected: false,
    capability: "report.render",
    lastUsed: "branch-impact"
  }
];

const simulationTurns: readonly SimulationTurnRecord[] = [
  {
    round: "004-A",
    actor: "Aria",
    action: "proposes opening west gate",
    status: "accepted with audit",
    artifact: "simulation/turns/round-004.json"
  },
  {
    round: "004-KP",
    actor: "KP",
    action: "requires oath rule citation",
    status: "waiting evidence",
    artifact: "agents/kp/memory.md"
  },
  {
    round: "004-AUDIT",
    actor: "Project Auditor",
    action: "flags timeline branch risk",
    status: "report queued",
    artifact: "reports/branch-impact.md"
  }
];

const reportRecords: readonly ReportRecord[] = [
  {
    name: "Branch Impact Report",
    type: "branch impact",
    path: "reports/branch-impact.md",
    risk: "medium",
    citations: "7 paths",
    status: "draft visible"
  },
  {
    name: "Consistency Audit",
    type: "audit",
    path: "reports/consistency-west-gate.md",
    risk: "high",
    citations: "12 paths",
    status: "needs KP rule"
  },
  {
    name: "Context Pack",
    type: "agent input",
    path: "simulation/context-packs/west-gate-004.md",
    risk: "low",
    citations: "18 paths",
    status: "ready"
  }
];

const scaffoldRecords: readonly ScaffoldRecord[] = [
  {
    name: "workspace.json",
    path: ".novelfabric/workspace.json",
    status: "valid",
    policy: "project identity"
  },
  {
    name: "template-manifest.json",
    path: ".novelfabric/template-manifest.json",
    status: "valid",
    policy: "template provenance"
  },
  {
    name: "capabilities.toml",
    path: ".novelfabric/capabilities.toml",
    status: "protected",
    policy: "role deny-by-default"
  }
];

const ragNodes: readonly RagNode[] = [
  {
    id: "aria",
    label: "Aria",
    filePath: "cards/characters/aria.md",
    kind: "character",
    x: 145,
    y: 120,
    summary: "角色节点：携带西门钥匙，受 soul.md 约束。",
    related: ["west-gate", "chapter-004", "branch-report"]
  },
  {
    id: "west-gate",
    label: "西门齿轮雨",
    filePath: "cards/world/clockwork-city.md",
    kind: "world",
    x: 360,
    y: 88,
    summary: "世界节点：影响城市季风节律与规则裁定。",
    related: ["aria", "kp-memory", "chapter-004"]
  },
  {
    id: "kp-memory",
    label: "KP 记忆",
    filePath: "agents/kp/memory.md",
    kind: "memory",
    x: 548,
    y: 194,
    summary: "受保护记忆节点：记录规则裁定依据。",
    related: ["west-gate", "branch-report"]
  },
  {
    id: "chapter-004",
    label: "第四章草稿",
    filePath: "writing/chapters/chapter-004.md",
    kind: "chapter",
    x: 255,
    y: 302,
    summary: "正文节点：承接 Aria 行动与 KP 裁定。",
    related: ["aria", "west-gate", "branch-report"]
  },
  {
    id: "branch-report",
    label: "分支影响报告",
    filePath: "reports/branch-impact.md",
    kind: "report",
    x: 610,
    y: 342,
    summary: "报告节点：追踪改写历史的影响面。",
    related: ["chapter-004", "kp-memory", "aria"]
  }
];

const ragEdges: readonly RagEdge[] = [
  { from: "aria", to: "west-gate", label: "acts_at" },
  { from: "aria", to: "chapter-004", label: "mentioned_in" },
  { from: "west-gate", to: "kp-memory", label: "requires_rule" },
  { from: "west-gate", to: "chapter-004", label: "valid_in_timeline" },
  { from: "chapter-004", to: "branch-report", label: "impacts" },
  { from: "kp-memory", to: "branch-report", label: "cited_by" }
];

const clusterColor = scaleOrdinal<string, string>()
  .domain(["character", "world", "memory", "chapter", "report"])
  .range(["#bb9af7", "#7dcfff", "#e0af68", "#9ece6a", "#7aa2f7"]);

const clusterNodes = ref<readonly ClusterSimNode[]>(
  ragNodes.map((node) => ({
    ...node,
    x: node.x,
    y: node.y
  }))
);
const clusterLinks = ref<readonly ClusterSimLink[]>(
  ragEdges.map((edge) => ({
    id: `${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label
  }))
);
const clusterZoom = ref(1);
const clusterPanX = ref(0);
const clusterPanY = ref(0);
const linkDistance = ref(180);
const chargeStrength = ref(-520);
const centerStrength = ref(0.12);
const collisionRadius = ref(76);
const clusterIsRunning = ref(true);
let clusterSimulation: Simulation<ClusterSimNode, ClusterSimLink> | undefined;

const clusterTransform = computed(
  () =>
    `translate(${clusterPanX.value.toString()} ${clusterPanY.value.toString()}) scale(${clusterZoom.value.toString()})`
);

const dynamicClusterEdges = computed(() =>
  clusterLinks.value.map((edge) => {
    const source = resolveSimNode(edge.source);
    const target = resolveSimNode(edge.target);
    const sourceX = source.x ?? 0;
    const sourceY = source.y ?? 0;
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;
    return {
      id: edge.id,
      label: edge.label,
      x1: sourceX,
      y1: sourceY,
      x2: targetX,
      y2: targetY,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2
    };
  })
);

function resolveSimNode(value: string | number | ClusterSimNode): ClusterSimNode {
  if (typeof value === "object") {
    return value;
  }
  return requireDefined(
    clusterNodes.value.find((node) => node.id === value),
    `cluster node ${value.toString()}`
  );
}

function clusterNodeColor(kind: RagNode["kind"]): string {
  return clusterColor(kind);
}

function initializeClusterSimulation(): void {
  clusterSimulation?.stop();
  clusterSimulation = forceSimulation<ClusterSimNode>([...clusterNodes.value])
    .force(
      "link",
      forceLink<ClusterSimNode, ClusterSimLink>([...clusterLinks.value])
        .id((node) => node.id)
        .distance(() => linkDistance.value)
        .strength(0.62)
    )
    .force(
      "charge",
      forceManyBody<ClusterSimNode>().strength(() => chargeStrength.value)
    )
    .force("center", forceCenter<ClusterSimNode>(380, 230).strength(centerStrength.value))
    .force(
      "collide",
      forceCollide<ClusterSimNode>().radius(() => collisionRadius.value)
    )
    .alpha(1)
    .alphaDecay(0.022)
    .on("tick", () => {
      clusterNodes.value = [...(clusterSimulation?.nodes() ?? [])];
    });
  clusterIsRunning.value = true;
}

function restartClusterSimulation(): void {
  if (clusterSimulation === undefined) {
    initializeClusterSimulation();
    return;
  }
  clusterSimulation
    .force(
      "link",
      forceLink<ClusterSimNode, ClusterSimLink>([...clusterLinks.value])
        .id((node) => node.id)
        .distance(() => linkDistance.value)
        .strength(0.62)
    )
    .force(
      "charge",
      forceManyBody<ClusterSimNode>().strength(() => chargeStrength.value)
    )
    .force("center", forceCenter<ClusterSimNode>(380, 230).strength(centerStrength.value))
    .force(
      "collide",
      forceCollide<ClusterSimNode>().radius(() => collisionRadius.value)
    )
    .alpha(0.9)
    .restart();
  clusterIsRunning.value = true;
}

function toggleClusterSimulation(): void {
  if (clusterSimulation === undefined) {
    initializeClusterSimulation();
    return;
  }
  if (clusterIsRunning.value) {
    clusterSimulation.stop();
    clusterIsRunning.value = false;
  } else {
    clusterSimulation.alpha(0.4).restart();
    clusterIsRunning.value = true;
  }
}

function zoomCluster(delta: number): void {
  clusterZoom.value = Math.max(0.25, clusterZoom.value + delta);
}

function resetClusterView(): void {
  clusterZoom.value = 1;
  clusterPanX.value = 0;
  clusterPanY.value = 0;
  linkDistance.value = 180;
  chargeStrength.value = -520;
  centerStrength.value = 0.12;
  collisionRadius.value = 76;
  initializeClusterSimulation();
}

function panCluster(deltaX: number, deltaY: number): void {
  clusterPanX.value += deltaX;
  clusterPanY.value += deltaY;
}

function startClusterPan(event: PointerEvent): void {
  if (event.target instanceof SVGElement && event.target.closest(".rag-node-group") !== null) {
    return;
  }
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const initialPanX = clusterPanX.value;
  const initialPanY = clusterPanY.value;
  const handleMove = (moveEvent: PointerEvent): void => {
    clusterPanX.value = initialPanX + moveEvent.clientX - startX;
    clusterPanY.value = initialPanY + moveEvent.clientY - startY;
  };
  const stopPan = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", stopPan);
    document.body.classList.remove("panning-cluster");
  };
  document.body.classList.add("panning-cluster");
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", stopPan, { once: true });
}

function startClusterNodeDrag(node: ClusterSimNode, event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  clusterSimulation?.stop();
  clusterIsRunning.value = false;
  const startX = event.clientX;
  const startY = event.clientY;
  const initialX = node.x ?? 0;
  const initialY = node.y ?? 0;
  const handleMove = (moveEvent: PointerEvent): void => {
    const nextX = initialX + (moveEvent.clientX - startX) / clusterZoom.value;
    const nextY = initialY + (moveEvent.clientY - startY) / clusterZoom.value;
    clusterNodes.value = clusterNodes.value.map((candidate) =>
      candidate.id === node.id
        ? { ...candidate, x: nextX, y: nextY, fx: nextX, fy: nextY }
        : candidate
    );
  };
  const stopDrag = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", stopDrag);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", stopDrag, { once: true });
}

watch([linkDistance, chargeStrength, centerStrength, collisionRadius], () => {
  restartClusterSimulation();
});

onMounted(() => {
  initializeClusterSimulation();
  initializeWorkspaceRoot();
  void loadWorkspaceTreeFromBridge();
  void ensureDraftLoaded("project.md", false);
});

onUnmounted(() => {
  clusterSimulation?.stop();
});

const stages: readonly SwarmStage[] = [
  {
    index: 1,
    label: "Objective",
    output: "推演西门事件对主线盟约的影响",
    detail: "目标已固定为 branch impact analysis；不会直接调用旧后端推演 API。"
  },
  {
    index: 2,
    label: "Context Pack",
    output: "cards + memory + timeline citations",
    detail: "上下文包包含人物卡、世界卡、规则卡、session turn 与 timeline 引用。"
  },
  {
    index: 3,
    label: "Agent Plan",
    output: "pi bridge prepares role-scoped prompts",
    detail: "pi SDK bridge 创建 role-scoped task；写入仍必须走 NovelFabric CLI。"
  },
  {
    index: 4,
    label: "Swarm Rounds",
    output: "append-turn via NovelFabric CLI",
    detail: "append-turn 会校验 actor/profile/capability，再落盘 turn record。"
  },
  {
    index: 5,
    label: "Artifacts",
    output: "report + session + role reasoning paths",
    detail: "最终产物是可审计文件：report、session、role_reasoning、context。"
  }
];

const lanes: readonly AgentLane[] = [
  {
    id: "main",
    role: "Main Agent",
    capability: "project.manage + report.render",
    status: "orchestrating",
    detail: "可以调度 workspace/report/knowledge，但仍不直接绕过 CLI 写事实。",
    accent: "cyan"
  },
  {
    id: "aria",
    role: "Aria",
    capability: "memory.recall + simulation.append_turn",
    status: "role scoped",
    detail: "只能读取自己的记忆和授权共享记忆，不能改 KP memory。",
    accent: "violet"
  },
  {
    id: "kp",
    role: "KP",
    capability: "validate-round + rule cards",
    status: "waiting",
    detail: "负责规则裁定，并将裁定以 turn output 形式交回。",
    accent: "green"
  },
  {
    id: "auditor",
    role: "Project Auditor",
    capability: "knowledge.insight",
    status: "blocked from protected writes",
    detail: "可以提出一致性风险，但不能直接修改 protected files。",
    accent: "amber"
  }
];

const frozenEndpoints: readonly FrozenEndpoint[] = [
  {
    name: "POST /api/external/swarm-inferences",
    detail: "create inference, preserve idempotency via client_request_id",
    fields: ["inference_id", "project_slug", "session_id", "artifact_paths", "summary_markdown"]
  },
  {
    name: "GET /api/external/swarm-inferences/{inference_id}",
    detail: "read back the same response field shape",
    fields: ["inference_id", "rounds_completed", "role_reasoning[]", "context_requirements"]
  },
  {
    name: "MCP external_swarm_infer",
    detail: "structuredContent mirrors HTTP response",
    fields: ["structuredContent", "content[0].text", "artifact_paths"]
  },
  {
    name: "MCP external_swarm_require_context",
    detail: "request more caller context without renaming tools",
    fields: ["context_requirements", "domain", "questions"]
  },
  {
    name: "MCP external_swarm_get",
    detail: "retrieve existing inference artifacts",
    fields: ["inference_id", "manifest", "report", "session"]
  }
];

const immutableFields = [
  "inference_id",
  "project_slug",
  "session_id",
  "domain",
  "rounds_completed",
  "artifact_paths.manifest",
  "artifact_paths.report",
  "artifact_paths.input_items[]",
  "artifact_paths.swarm_rounds[]",
  "summary_markdown",
  "context_requirements",
  "role_reasoning[]"
] as const;

const activeFunction = ref<FunctionId>("workspace");
const selectedFilePath = ref("project.md");
const selectedRagNodeId = ref("aria");
const activeStageIndex = ref(3);
const selectedLaneId = ref("main");
const selectedEndpointName = ref(frozenEndpoints[0]?.name ?? "");
const activeTabId = ref("file:project.md");
const expandedPaths = ref<Set<string>>(new Set(["."]));
const searchQuery = ref("");
const promptText = ref("请规划西门事件下一轮：先生成 CLI plan，再按 capability 写入工作区。");
const importUpload = ref<ImportUpload | null>(null);
const importStatus = ref("imports/source/ 已作为原始拆书文件收件箱加入 V4 workspace layout。");
const chatMessages = ref<readonly ChatMessage[]>([
  {
    id: "system-1",
    role: "system",
    author: "NovelFabric",
    content:
      "当前聊天 buffer 用于组织 CLI plan、文件操作和推演任务；未连接 bridge 时不会写入磁盘。",
    meta: "workspace buffer"
  },
  {
    id: "kp-1",
    role: "agent",
    author: "KP",
    content: "西门行动需要规则卡佐证。我会等待 Aria 的行动草案，然后生成 append-turn。",
    meta: "role: kp"
  },
  {
    id: "aria-1",
    role: "assistant",
    author: "Aria",
    content: "我会交出钥匙，但要求先确认失踪者名单。请把这次行动写入本轮上下文包。",
    meta: "role: aria"
  }
]);

const chatSessions = [
  { id: "session-west-gate", label: "西门齿轮雨", status: "running" },
  { id: "session-branch", label: "分支影响审计", status: "draft" },
  { id: "session-kp", label: "KP 裁定", status: "paused" }
] as const;
const toastMessage = ref("已修正语义：左侧是功能，顶部 tab 只代表已打开的文件或管理器节点。");
const sidebarWidth = ref(330);
const inspectorWidth = ref(300);
const chatHeight = ref(255);
const sessionPaneHeight = ref(190);

const shellStyle = computed(() => ({
  "--sidebar-width": `${sidebarWidth.value.toString()}px`,
  "--inspector-width": `${inspectorWidth.value.toString()}px`,
  "--chat-height": `${chatHeight.value.toString()}px`,
  "--session-pane-height": `${sessionPaneHeight.value.toString()}px`
}));

const editableContents = ref<Record<string, string>>({
  "project.md":
    "# 齿轮雨之城\n\n主题：蒸汽朋克城市中的盟约、背叛与时间线分叉。\n\n- 当前目标：保持主线连续性\n- 当前风险：西门事件可能产生 branch-impact report\n- 写入原则：所有事实必须落到 workspace 文件",
  "project.json": JSON.stringify(
    {
      schemaVersion: "v4",
      slug: "workspace-novel",
      title: "齿轮雨之城",
      activeSession: "session-west-gate-004",
      importInbox: "imports/source"
    },
    null,
    2
  ),
  ".novelfabric/workspace.json": JSON.stringify(
    { schemaVersion: "v4", projectSlug: "workspace-novel", template: "novel-project" },
    null,
    2
  ),
  ".novelfabric/template-manifest.json": JSON.stringify(
    { schemaVersion: "v4", templates: ["novel-project", "source-import", "story-cards"] },
    null,
    2
  ),
  "imports/source/gear-rain-fulltext.txt":
    "第一章 雨夜齿轮\n\n阿莉娅把钥匙放进信封，齿轮雨敲响西门。\n\n第二章 钟楼名单\n\n名单上的名字正在从城市记忆中消失。",
  "imports/source/west-gate-outline.md":
    "# West Gate Outline\n\n- 西门排放齿轮雨\n- Aria 持有钥匙\n- KP 要求 oath-lock 规则引用",
  "imports/source/old-draft-2.txt": "旧稿导入候选；文件名已重命名以避免覆盖原始来源。",
  "cards/characters/aria.md":
    "# Aria\n\n核心欲望：找到钟楼雨幕背后的失踪者名单。\n\n约束：不得突然获得未由上下文授权的新知识。",
  "cards/rules/oath-lock.md":
    "# Oath Lock\n\n当角色使用西门钥匙时，KP 必须要求誓约规则引用。\n\n- 证据：simulation/turns/round-004.json\n- 风险：缺失引用会触发 project-auditor。",
  "cards/scenes/west-gate-rain.md":
    "# West Gate Rain\n\n场景：西门齿轮雨。\n\n- 出场：Aria / KP\n- 证据：writing/chapters/chapter-004.md\n- 冲突：打开西门会制造时间线分支。",
  "cards/world/clockwork-city.md": "# Clockwork City\n\n七座钟楼维持季风节律。西门负责排放齿轮雨。",
  "agents/aria/soul.md":
    "# Aria Soul\n\n受保护身份文件。角色 subagent 不能直接覆盖此文件，只能提交 proposal。",
  "agents/kp/memory.md": "# KP Memory\n\n受保护记忆：规则裁定必须引用规则卡与 session turn。",
  "agents/project-auditor/skills/consistency-audit.md":
    "# Consistency Audit Skill\n\n检查 timeline、cards、memory 与 writing 是否互相冲突。\n\n目标输出：reports/consistency-west-gate.md。",
  "simulation/active-session.txt": "session-west-gate-004\nround=004\nnext=project-auditor",
  "simulation/turns/round-004.json": JSON.stringify(
    {
      round: 4,
      actor: "aria",
      action: "open-west-gate",
      evidencePaths: ["cards/characters/aria.md", "cards/world/clockwork-city.md"],
      consistency: { status: "needs_audit", reason: "branch risk" }
    },
    null,
    2
  ),
  "simulation/context-packs/west-gate-004.md":
    "# Context Pack: West Gate 004\n\n- cards/characters/aria.md\n- cards/world/clockwork-city.md\n- simulation/turns/round-004.json",
  "writing/chapters/chapter-004.md":
    "# 第四章：西门齿轮雨\n\n阿莉娅把钥匙按进青铜门缝，听见远处钟楼开始倒数。",
  "writing/chapters/import-preview.md":
    "# Import Preview\n\n拆章预览将把 imports/source/gear-rain-fulltext.txt 切分为三个候选章节。",
  "writing/chapters/第二章 钟楼名单.md":
    "# 第二章 钟楼名单\n\n名单上的名字在钟声里逐渐消失，Aria 必须确认失踪者是否曾经存在。",
  "reports/branch-impact.md":
    "# Branch Impact Report\n\n西门事件若改写历史，需要从 tp-0007 创建 branch-west-gate。\n\n- 影响：Aria 记忆\n- 影响：钟楼世界卡\n- 影响：第四章草稿",
  "reports/consistency-west-gate.md":
    "# Consistency Audit: West Gate\n\n风险：Oath Lock 规则引用缺失。\n\n建议：先补 cards/rules/oath-lock.md 再推进 round-005。",
  "reports/import-summary.md":
    "# Import Summary\n\n源文件：imports/source/gear-rain-fulltext.txt\n\n结果：18 个章节候选，2 个标题歧义。",
  ".novelfabric/capabilities.toml":
    '[main_agent]\nallow = ["project.manage", "report.render", "knowledge.query"]\n\n[role_agent]\nallow = ["memory.recall", "simulation.append_turn"]\ndeny = ["files.patch_protected", "external_swarm.run"]\n'
});

const fileDrafts = ref<Record<string, FileDraft>>({});
const bridgeHealth = ref<BridgeHealth>("unknown");
const bridgeEnabled = ref(false);
const workspaceRoot = ref(".");
const defaultEditorActor = ref("main_agent");

const openTabs = ref<readonly Tab[]>([
  {
    id: "file:project.md",
    label: "project.md",
    kind: "file",
    target: "project.md",
    functionId: "workspace"
  }
]);

const activeFunctionMeta = computed(() => {
  if (activeFunction.value === "api") {
    return {
      id: "api",
      label: "兼容文档",
      icon: "♢",
      description: "二层 /mcp.md 文档入口，供外部 agent 直接读取"
    } satisfies SidebarFunction;
  }
  if (activeFunction.value === "chat") {
    return {
      id: "chat",
      label: "聊天 Buffer",
      icon: "✦",
      description: "网页端一等公民：通过聊天操作文件、推演和分镜"
    } satisfies SidebarFunction;
  }
  return requireDefined(
    sidebarFunctions.find((entry) => entry.id === activeFunction.value) ?? sidebarFunctions[0],
    "active function metadata"
  );
});
const selectedFile = computed(() =>
  previews.find((preview) => preview.path === selectedFilePath.value)
);
const selectedRagNode = computed(() =>
  requireDefined(
    ragNodes.find((node) => node.id === selectedRagNodeId.value) ?? ragNodes[0],
    "selected cluster node"
  )
);
const activeStage = computed(() =>
  requireDefined(
    stages.find((stage) => stage.index === activeStageIndex.value) ?? stages[0],
    "active swarm stage"
  )
);
const selectedLane = computed(() =>
  requireDefined(
    lanes.find((lane) => lane.id === selectedLaneId.value) ?? lanes[0],
    "selected agent lane"
  )
);
const activeTab = computed(
  () => openTabs.value.find((tab) => tab.id === activeTabId.value) ?? openTabs.value[0] ?? null
);
const hasOpenTabs = computed(() => activeTab.value !== null);
const activeDirectoryManager = computed(() => {
  const tab = activeTab.value;
  return tab === null ? null : managerForDirectory(tab.target);
});
const activeDirectoryChildren = computed(() => {
  const tab = activeTab.value;
  return tab === null ? [] : childRowsForDirectory(tab.target);
});
const activeFilePath = computed(() => {
  const tab = activeTab.value;
  return tab?.kind === "file" ? tab.target : selectedFilePath.value;
});
const activeFileMode = computed(() => fileModeForPath(activeFilePath.value));
const activeFileDraft = computed(() => draftForPath(activeFilePath.value));
const activeFileContent = computed({
  get() {
    return activeFileDraft.value.current;
  },
  set(value: string) {
    updateDraftContent(activeFilePath.value, value);
  }
});
const activeFileLocked = computed(() => activeFileDraft.value.locked);
const activeFileStatus = computed(() => statusTextForDraft(activeFileDraft.value));
const markdownHtml = computed(() => renderMarkdownHtml(activeFileContent.value));
const jsonPreview = computed(() => jsonPreviewRows(activeFileContent.value));
const activeRagContent = computed({
  get() {
    const node = selectedRagNode.value;
    return draftForPath(node.filePath).current;
  },
  set(value: string) {
    const node = selectedRagNode.value;
    updateDraftContent(node.filePath, value);
  }
});
function flattenWorkspaceTree(
  nodes: readonly WorkspaceNode[],
  depth = 0
): readonly WorkspaceTreeRow[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenWorkspaceTree(node.children ?? [], depth + 1)
  ]);
}

const relatedRagNodes = computed(() => {
  const node = selectedRagNode.value;
  return ragNodes.filter((candidate) => node.related.includes(candidate.id));
});
const workspaceRows = computed(() => flattenWorkspaceTree(workspaceTree.value));
const visibleWorkspaceRows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const expanded = expandedPaths.value;
  const filteredByExpand = treeRowsForExpanded(workspaceRows.value, expanded);
  if (query.length === 0) {
    return filteredByExpand;
  }
  return filteredByExpand.filter(
    (row) =>
      row.node.path.toLowerCase().includes(query) || row.node.label.toLowerCase().includes(query)
  );
});

function initializeWorkspaceRoot(): void {
  const params = new URLSearchParams(window.location.search);
  const configuredWorkspace = params.get("workspace") ?? params.get("workspacePath");
  const configuredActor = params.get("actor");
  bridgeEnabled.value = configuredWorkspace !== null && configuredWorkspace.trim().length > 0;
  workspaceRoot.value = configuredWorkspace ?? ".";
  defaultEditorActor.value = configuredActor ?? "main_agent";
  bridgeHealth.value = bridgeEnabled.value ? "unknown" : "offline-buffer";
}

function draftForPath(pathValue: string): FileDraft {
  const existing = fileDrafts.value[pathValue];
  if (existing !== undefined) return existing;
  return createSeedDraft(pathValue, false);
}

function createSeedDraft(pathValue: string, locked: boolean): FileDraft {
  const content = editableContents.value[pathValue] ?? fallbackContentForPath(pathValue);
  return {
    original: content,
    current: content,
    baseHash: null,
    dirty: false,
    loading: false,
    saving: false,
    locked,
    error: "",
    source: "seed",
    lastSavedAuditPath: null
  };
}

function setDraft(pathValue: string, draft: FileDraft): void {
  fileDrafts.value = { ...fileDrafts.value, [pathValue]: draft };
  editableContents.value = { ...editableContents.value, [pathValue]: draft.current };
}

function updateDraftContent(pathValue: string, value: string): void {
  const draft = draftForPath(pathValue);
  if (draft.locked) return;
  setDraft(pathValue, {
    ...draft,
    current: value,
    dirty: value !== draft.original,
    error: "",
    lastSavedAuditPath: draft.lastSavedAuditPath
  });
}

async function ensureDraftLoaded(pathValue: string, locked: boolean, force = false): Promise<void> {
  const existing = fileDrafts.value[pathValue];
  if (!force && existing !== undefined && existing.source === "bridge") return;
  if (existing?.loading === true) return;

  if (!bridgeEnabled.value) {
    setDraft(pathValue, { ...(existing ?? createSeedDraft(pathValue, locked)), locked });
    return;
  }

  setDraft(pathValue, {
    ...(existing ?? createSeedDraft(pathValue, locked)),
    locked,
    loading: true
  });
  try {
    const result = await bridgeReadFile(pathValue);
    bridgeHealth.value = "live";
    setDraft(pathValue, {
      original: result.content,
      current: result.content,
      baseHash: result.hash,
      dirty: false,
      loading: false,
      saving: false,
      locked: locked || result.protected,
      error: "",
      source: "bridge",
      lastSavedAuditPath: null
    });
  } catch (error) {
    bridgeHealth.value = "offline-buffer";
    const message = bridgeErrorMessage(error);
    const fallback = existing ?? createSeedDraft(pathValue, locked);
    setDraft(pathValue, {
      ...fallback,
      locked,
      loading: false,
      error: `未连接 workspace bridge，使用离线 buffer：${message}`,
      source: "seed"
    });
  }
}

async function saveActiveFile(): Promise<void> {
  await saveFilePath(activeFilePath.value);
}

async function saveFilePath(pathValue: string): Promise<void> {
  const draft = draftForPath(pathValue);
  if (draft.locked) {
    toastMessage.value = `受保护文件 ${pathValue} 默认不能直接保存。`;
    return;
  }
  if (!draft.dirty) {
    toastMessage.value = `${pathValue} 没有未保存修改。`;
    return;
  }
  if (draft.source !== "bridge" || draft.baseHash === null) {
    setDraft(pathValue, {
      ...draft,
      error: "当前为离线 buffer；请通过 ?workspace=/absolute/path 连接本地 bridge 后再保存。"
    });
    toastMessage.value = "未连接真实 workspace，未写入磁盘。";
    return;
  }

  const submittedContent = draft.current;
  const submittedBaseHash = draft.baseHash;
  setDraft(pathValue, { ...draft, saving: true, error: "" });
  try {
    const result = await bridgeWriteFile(pathValue, submittedContent, submittedBaseHash);
    bridgeHealth.value = "live";
    const latest = draftForPath(pathValue);
    const changedDuringSave = latest.current !== submittedContent;
    setDraft(pathValue, {
      ...latest,
      original: submittedContent,
      baseHash: result.hash,
      dirty: changedDuringSave,
      saving: false,
      error: "",
      source: "bridge",
      lastSavedAuditPath: result.auditPath
    });
    toastMessage.value = changedDuringSave
      ? `已保存 ${pathValue} 的提交版本；仍有新的未保存修改。`
      : `已保存 ${pathValue}，审计记录：${result.auditPath}`;
  } catch (error) {
    const message = bridgeErrorMessage(error);
    const latest = draftForPath(pathValue);
    setDraft(pathValue, { ...latest, saving: false, error: message });
    toastMessage.value = `保存失败：${message}`;
  }
}

async function reloadActiveFile(): Promise<void> {
  const pathValue = activeFilePath.value;
  const draft = draftForPath(pathValue);
  if (draft.dirty && !window.confirm(`重读会丢弃 ${pathValue} 的未保存修改，继续吗？`)) return;
  await ensureDraftLoaded(pathValue, activeFileLocked.value, true);
  toastMessage.value = `已重新读取 ${pathValue}。`;
}

function statusTextForDraft(draft: FileDraft): string {
  if (draft.loading) return "loading from bridge";
  if (draft.saving) return "saving…";
  if (draft.locked) return "protected read-only";
  if (draft.dirty) return "dirty · ready to save";
  if (draft.source === "bridge") return "saved · real workspace";
  return "offline buffer";
}

type BridgeReadResult = {
  readonly path: string;
  readonly content: string;
  readonly hash: string;
  readonly bytes: number;
  readonly protected: boolean;
};

type BridgeWriteResult = {
  readonly path: string;
  readonly hash: string;
  readonly previousHash: string | null;
  readonly bytes: number;
  readonly protected: boolean;
  readonly auditPath: string;
};

type BridgeTreeResult = {
  readonly root: string;
  readonly tree: WorkspaceNode;
};

async function bridgeReadFile(pathValue: string): Promise<BridgeReadResult> {
  return bridgeRequest<BridgeReadResult>("/api/bridge/files/read", {
    workspacePath: workspaceRoot.value,
    path: pathValue
  });
}

async function loadWorkspaceTreeFromBridge(): Promise<void> {
  if (!bridgeEnabled.value) return;
  try {
    const result = await bridgeRequest<BridgeTreeResult>("/api/bridge/files/tree", {
      workspacePath: workspaceRoot.value
    });
    workspaceTree.value = [result.tree];
    bridgeHealth.value = "live";
  } catch (error) {
    bridgeHealth.value = "offline-buffer";
    toastMessage.value = `真实文件树读取失败，继续使用内置布局：${bridgeErrorMessage(error)}`;
  }
}

async function bridgeWriteFile(
  pathValue: string,
  content: string,
  expectedBaseHash: string | undefined
): Promise<BridgeWriteResult> {
  return bridgeRequest<BridgeWriteResult>("/api/bridge/files/write", {
    workspacePath: workspaceRoot.value,
    path: pathValue,
    content,
    ...(expectedBaseHash === undefined ? {} : { expectedBaseHash }),
    actor: defaultEditorActor.value,
    reason: "web editor save"
  });
}

async function bridgeRequest<TResult>(url: string, body: Record<string, string>): Promise<TResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = parseBridgeEnvelope(await response.json());
  if (!payload.ok) {
    throw new Error(`${payload.error.code}: ${payload.error.message}`);
  }
  return payload.data as TResult;
}

function parseBridgeEnvelope(
  value: unknown
):
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: BridgeError } {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return {
      ok: false,
      error: { code: "invalid_bridge_response", message: "Invalid bridge response." }
    };
  }
  if (value.ok === true && "data" in value) {
    return { ok: true, data: value.data };
  }
  if (value.ok === false && "error" in value && isBridgeError(value.error)) {
    return { ok: false, error: value.error };
  }
  return {
    ok: false,
    error: { code: "invalid_bridge_response", message: "Invalid bridge response." }
  };
}

function isBridgeError(value: unknown): value is BridgeError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function bridgeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected bridge failure.";
}

function toggleExpand(pathValue: string): void {
  const next = new Set(expandedPaths.value);
  if (next.has(pathValue)) {
    next.delete(pathValue);
  } else {
    next.add(pathValue);
  }
  expandedPaths.value = next;
}

function toggleDirectoryExpand(node: WorkspaceNode): void {
  if (node.kind !== "directory") return;
  toggleExpand(node.path);
}

function expandToPath(pathValue: string): void {
  const target = workspaceRows.value.find((row) => row.node.path === pathValue)?.node;
  const isDirectory = target?.kind === "directory";
  const pathParts = pathValue === "." ? ["."] : pathValue.split("/");
  const maxDepth = isDirectory ? pathParts.length : Math.max(pathParts.length - 1, 0);
  const next = new Set(expandedPaths.value);
  next.add(".");
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    next.add(pathParts.slice(0, depth).join("/"));
  }
  expandedPaths.value = next;
}

function isExpanded(pathValue: string): boolean {
  return expandedPaths.value.has(pathValue);
}

function expandAll(): void {
  const next = new Set<string>();
  for (const row of workspaceRows.value) {
    if (row.node.kind === "directory") next.add(row.node.path);
  }
  expandedPaths.value = next;
}

function collapseAll(): void {
  expandedPaths.value = new Set(["."]);
}

function managerForDirectory(pathValue: string): DirectoryManager {
  const explicit = directoryManagers.find((manager) => manager.path === pathValue);
  if (explicit !== undefined) return explicit;
  return {
    path: pathValue,
    kind: "files",
    title: `${pathValue}/`,
    description:
      "目录内容工作台：展示该目录下的直接子项；点击实体文件进入编辑器，点击子目录继续下钻。"
  };
}

function childRowsForDirectory(pathValue: string): readonly WorkspaceTreeRow[] {
  const targetDepth = workspaceRows.value.find((row) => row.node.path === pathValue)?.depth ?? 0;
  return workspaceRows.value.filter((row) => {
    if (row.node.path === pathValue) return false;
    if (!row.node.path.startsWith(pathValue === "." ? "" : `${pathValue}/`)) return false;
    return row.depth === targetDepth + 1;
  });
}

function switchFunction(id: FunctionId): void {
  activeFunction.value = id;
  const managerTab = managerTabFor(id);
  openTab(managerTab);
  toastMessage.value = `已切换功能：${managerTab.label}。顶部 tab 表示打开的管理器节点。`;
}

function openCompatibilityDocs(): void {
  activeFunction.value = "api";
  openTab({
    id: "manager:mcp.md",
    label: "/mcp.md",
    kind: "manager",
    target: "/mcp.md",
    functionId: "api"
  });
  toastMessage.value = "已打开二层兼容文档 /mcp.md；它主要供外部 agent 直接读取。";
}

function fileIconClass(node: WorkspaceNode): FileIconClass {
  if (node.kind === "directory") {
    if (node.path.includes("cards")) return "icon-card";
    if (node.path.includes("agents")) return "icon-agent";
    if (node.path.includes("simulation")) return "icon-simulation";
    return "icon-folder";
  }

  if (node.protected === true) return "icon-locked";
  if (node.path.endsWith(".json")) return "icon-json";
  if (node.path.includes("characters")) return "icon-character";
  if (node.path.includes("world")) return "icon-world";
  if (node.path.includes("reports")) return "icon-report";
  if (node.path.includes("simulation")) return "icon-simulation";
  if (node.path.endsWith(".toml")) return "icon-config";
  if (node.path.endsWith(".md")) return "icon-markdown";
  return "icon-text";
}

function fileIconLabel(node: WorkspaceNode): string {
  if (node.kind === "directory") return "directory";
  if (node.protected === true) return "protected file";
  if (node.path.endsWith(".json")) return "json file";
  if (node.path.endsWith(".toml")) return "config file";
  if (node.path.endsWith(".md")) return "markdown file";
  return "text file";
}

function selectNode(node: WorkspaceNode): void {
  if (node.kind === "directory") {
    openDirectoryNode(node);
    return;
  }
  openFileNode(node);
}

function openDirectoryOrFile(node: WorkspaceNode): void {
  if (node.kind === "directory") {
    openDirectoryNode(node);
    return;
  }
  openFileNode(node);
}

function openDirectoryNode(node: WorkspaceNode): void {
  activeFunction.value = "workspace";
  selectedFilePath.value = node.path;
  openTab({
    id: `manager:${node.path}`,
    label: node.label,
    kind: "manager",
    target: node.path,
    functionId: "workspace"
  });
  toastMessage.value = `已打开目录管理器节点：${node.path}。`;
}

function openFileNode(node: WorkspaceNode): void {
  activeFunction.value = "workspace";
  selectedFilePath.value = node.path;
  openTab({
    id: `file:${node.path}`,
    label: node.label,
    kind: "file",
    target: node.path,
    functionId: "workspace",
    ...(node.protected === true ? { locked: true } : {})
  });
  toastMessage.value =
    node.protected === true
      ? `已打开受保护文件 ${node.path}（只读预览）。`
      : `已打开文件 ${node.path}。`;
}

function selectRagNode(node: RagNode | ClusterSimNode): void {
  activeFunction.value = "rag";
  selectedRagNodeId.value = node.id;
  selectedFilePath.value = node.filePath;
  openTab({
    id: `cluster:${node.id}`,
    label: node.label,
    kind: "rag-node",
    target: node.filePath,
    functionId: "rag"
  });
  void ensureDraftLoaded(node.filePath, false);
  toastMessage.value = `已打开集群节点：${node.label}，可在右侧编辑对应文件内容。`;
}

function selectStage(stage: SwarmStage): void {
  activeStageIndex.value = stage.index;
  activeFunction.value = "swarm";
  openTab({
    id: `manager:swarm-stage-${stage.index.toString()}`,
    label: stage.label,
    kind: "manager",
    target: stage.label,
    functionId: "swarm"
  });
}

function selectLane(lane: AgentLane): void {
  selectedLaneId.value = lane.id;
  activeFunction.value = "swarm";
  openTab({
    id: `manager:agent-${lane.id}`,
    label: lane.role,
    kind: "manager",
    target: lane.id,
    functionId: "swarm"
  });
}

function selectEndpoint(endpoint: FrozenEndpoint): void {
  selectedEndpointName.value = endpoint.name;
  activeFunction.value = "api";
  openTab({
    id: `manager:${endpoint.name}`,
    label: endpoint.name.replace("/api/external/", ""),
    kind: "manager",
    target: endpoint.name,
    functionId: "api"
  });
  toastMessage.value = `已选择兼容接口：${endpoint.name}`;
}

function activateTab(tab: Tab): void {
  activeTabId.value = tab.id;
  activeFunction.value = tab.functionId;
  if (tab.kind === "file") {
    selectedFilePath.value = tab.target;
    void ensureDraftLoaded(tab.target, tab.locked === true);
  }
  if (tab.kind === "rag-node") {
    const node = ragNodes.find((candidate) => candidate.filePath === tab.target);
    if (node !== undefined) {
      selectedRagNodeId.value = node.id;
    }
  }
}

function closeTab(tab: Tab): void {
  if (!confirmClosingTabs([tab])) return;
  const nextTabs = openTabs.value.filter((candidate) => candidate.id !== tab.id);
  openTabs.value = nextTabs;
  if (nextTabs.length === 0) {
    switchToChatAfterTabsClosed("已关闭最后一个 tab，自动切换到聊天 buffer。");
    return;
  }
  if (activeTabId.value === tab.id) {
    const fallback = requireDefined(nextTabs[0], "fallback tab");
    activateTab(fallback);
  }
}

function closeAllTabs(): void {
  if (!confirmClosingTabs(openTabs.value)) return;
  openTabs.value = [];
  switchToChatAfterTabsClosed("已关闭全部 tab，当前显示聊天 buffer。");
}

function scrollTabbarHorizontally(event: WheelEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const dominantDelta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  event.currentTarget.scrollLeft += dominantDelta;
}

function confirmClosingTabs(tabs: readonly Tab[]): boolean {
  const dirtyFileTabs = tabs.filter((tab) => tab.kind === "file" && draftForPath(tab.target).dirty);
  if (dirtyFileTabs.length === 0) return true;
  return window.confirm(
    `还有 ${dirtyFileTabs.length.toString()} 个文件未保存，关闭 tab 会保留内存草稿但不会写入磁盘。继续关闭吗？`
  );
}

function switchToChatAfterTabsClosed(message: string): void {
  activeTabId.value = "";
  activeFunction.value = "chat";
  toastMessage.value = message;
}

function openWorkspacePath(pathValue: string): void {
  const normalized = pathValue.replace(/\/$/, "");
  expandToPath(normalized);
  const manager = directoryManagers.find((entry) => entry.path === normalized);
  if (manager !== undefined) {
    openDirectoryNode({ label: manager.title, path: manager.path, kind: "directory" });
    return;
  }
  const existing = workspaceRows.value.find((row) => row.node.path === normalized)?.node;
  if (existing !== undefined) {
    openDirectoryOrFile(existing);
    return;
  }
  const protectedFile = normalized.includes(".novelfabric/") || normalized.includes("/soul.md");
  openFileNode({
    label: fileLabelForPath(normalized),
    path: normalized,
    kind: "file",
    ...(protectedFile ? { protected: true } : {})
  });
}

function fileLabelForPath(pathValue: string): string {
  return pathValue.split("/").pop() ?? pathValue;
}

async function stageSourceImport(event: Event): Promise<void> {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) {
    return;
  }

  const fileName = normalizeWorkspaceFileName(file.name);
  const targetPath = `imports/source/${fileName}`;
  let sourceText = "";
  try {
    sourceText = await file.text();
  } catch {
    sourceText = "文件已选择；当前浏览器无法生成文本预览。";
  }
  const preview = sourceText.slice(0, 420).trim();

  importUpload.value = {
    fileName,
    targetPath,
    sizeLabel: formatFileSize(file.size),
    preview: preview.length > 0 ? preview : "文件为空，主 agent 执行拆书前应先要求作者确认。"
  };
  editableContents.value = { ...editableContents.value, [targetPath]: sourceText };
  setDraft(targetPath, {
    ...createSeedDraft(targetPath, false),
    original: sourceText,
    current: sourceText,
    dirty: !bridgeEnabled.value
  });

  if (bridgeEnabled.value) {
    try {
      const result = await bridgeWriteFile(targetPath, sourceText, undefined);
      setDraft(targetPath, {
        original: sourceText,
        current: sourceText,
        baseHash: result.hash,
        dirty: false,
        loading: false,
        saving: false,
        locked: false,
        error: "",
        source: "bridge",
        lastSavedAuditPath: result.auditPath
      });
      await loadWorkspaceTreeFromBridge();
      importStatus.value = `已写入 ${file.name} → ${targetPath}；审计记录：${result.auditPath}`;
      toastMessage.value = `已写入原始拆书文件：${targetPath}`;
    } catch (error) {
      toastMessage.value = `导入写入失败，已保留离线 buffer：${bridgeErrorMessage(error)}`;
    }
  } else {
    workspaceTree.value = insertWorkspaceFile(workspaceTree.value, {
      label: fileName,
      path: targetPath,
      kind: "file"
    });
    importStatus.value = `已加入离线 buffer：${file.name} → ${targetPath}；连接 bridge 后可保存到工作区。`;
    toastMessage.value = `已选择原始拆书文件：${targetPath}`;
  }

  expandToPath(targetPath);
  openWorkspacePath(targetPath);
}

function normalizeWorkspaceFileName(name: string): string {
  const normalized = name.trim().replaceAll("\\", "/").split("/").pop() ?? "source.txt";
  const safe = normalized.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "source.txt";
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size.toString()} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileModeForPath(pathValue: string): FileMode {
  if (pathValue.endsWith(".md")) return "markdown";
  if (pathValue.endsWith(".json")) return "json";
  if (pathValue.endsWith(".toml")) return "toml";
  return "text";
}

function fallbackContentForPath(pathValue: string): string {
  if (pathValue === "imports/source") {
    return importStatus.value;
  }
  if (pathValue === ".") {
    return [
      "# Workspace Overview",
      "",
      "- Layout-only V4 mono app",
      "- Canonical import inbox: imports/source/",
      "- File clicks open editors; folder clicks open manager pages"
    ].join("\n");
  }
  return `# ${pathValue}\n\nNo workspace content loaded for this path yet.`;
}

function renderMarkdownHtml(content: string): string {
  const rendered = marked.parse(content, { async: false });
  return DOMPurify.sanitize(rendered);
}

function jsonPreviewRows(content: string): readonly JsonPreviewRow[] {
  let parsedText: JsonValue;
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return [
        {
          id: "json-schema-error",
          depth: 0,
          label: "JSON schema error",
          kind: "error",
          summary: "unsupported",
          value: "Only JSON objects, arrays, strings, numbers, booleans, and null are supported"
        }
      ];
    }
    parsedText = parsed.data;
  } catch {
    return [
      {
        id: "json-parse-error",
        depth: 0,
        label: "JSON parse error",
        kind: "error",
        summary: "invalid",
        value: "Invalid JSON content"
      }
    ];
  }

  const rows: JsonPreviewRow[] = [];
  const visit = (
    value: JsonValue,
    depth: number,
    label: string,
    pathParts: readonly string[]
  ): void => {
    const id = pathParts.length === 0 ? "root" : pathParts.join("/");
    if (Array.isArray(value)) {
      rows.push({
        id,
        depth,
        label,
        kind: "array",
        summary: `${value.length.toString()} item${value.length === 1 ? "" : "s"}`,
        value: "[]"
      });
      value.forEach((entry, index) =>
        visit(entry, depth + 1, `[${index.toString()}]`, [...pathParts, index.toString()])
      );
      return;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      rows.push({
        id,
        depth,
        label,
        kind: "object",
        summary: `${entries.length.toString()} key${entries.length === 1 ? "" : "s"}`,
        value: "{}"
      });
      for (const [key, entry] of entries) {
        visit(entry, depth + 1, key, [...pathParts, key]);
      }
      return;
    }
    const kind = jsonPrimitiveKind(value);
    rows.push({
      id,
      depth,
      label,
      kind,
      summary: kind,
      value: jsonPrimitivePreview(value)
    });
  };

  visit(parsedText, 0, "root", []);
  return rows;
}

function jsonPrimitiveKind(value: string | number | boolean | null): JsonPreviewKind {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function jsonPrimitivePreview(value: string | number | boolean | null): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function submitPreviewRun(): void {
  const text = promptText.value.trim();
  if (text.length === 0) {
    toastMessage.value = "请输入任务文本；未连接 bridge 时只会进入离线 buffer。";
    return;
  }
  chatMessages.value = [
    ...chatMessages.value,
    {
      id: `user-${Date.now().toString()}`,
      role: "user",
      author: "你",
      content: text,
      meta: "local prompt"
    },
    {
      id: `assistant-${Date.now().toString()}`,
      role: "assistant",
      author: "NovelFabric Orchestrator",
      content:
        "已生成执行计划：context-pack → pi bridge task → append-turn。写入前会经过 capability 校验。",
      meta: "plan response"
    }
  ];
  promptText.value = "";
  toastMessage.value = bridgeEnabled.value
    ? "已追加任务消息；后续写入请通过 CLI-backed bridge 执行。"
    : "已追加离线 buffer 消息；当前未连接 workspace bridge。";
}

async function saveRagContent(): Promise<void> {
  await saveFilePath(selectedRagNode.value.filePath);
}

function managerTabFor(id: FunctionId): Tab {
  const meta = requireDefined(
    sidebarFunctions.find((entry) => entry.id === id) ?? sidebarFunctions[0],
    "manager function metadata"
  );
  const target = id === "workspace" ? "." : id;
  return { id: `manager:${id}`, label: meta.label, kind: "manager", target, functionId: id };
}

function startResize(kind: ResizeKind, event: PointerEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const initialSidebar = sidebarWidth.value;
  const initialInspector = inspectorWidth.value;
  const initialChat = chatHeight.value;
  const initialSession = sessionPaneHeight.value;

  const handleMove = (moveEvent: PointerEvent): void => {
    if (kind === "sidebar") {
      sidebarWidth.value = clampMinimum(initialSidebar + moveEvent.clientX - startX, 80);
    } else if (kind === "inspector") {
      inspectorWidth.value = clampMinimum(initialInspector - (moveEvent.clientX - startX), 48);
    } else if (kind === "chat") {
      chatHeight.value = clampMinimum(initialChat - (moveEvent.clientY - startY), 44);
    } else {
      sessionPaneHeight.value = clampMinimum(initialSession - (moveEvent.clientY - startY), 32);
    }
  };

  const stopResize = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", stopResize);
    document.body.classList.remove("resizing-buffer");
  };

  document.body.classList.add("resizing-buffer");
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", stopResize, { once: true });
}

function clampMinimum(value: number, minimum: number): number {
  return Math.max(value, minimum);
}

function requireDefined<TValue>(value: TValue | undefined, label: string): TValue {
  if (value === undefined) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function openTab(tab: Tab): void {
  const existing = openTabs.value.find(
    (candidate) =>
      candidate.id === tab.id || (candidate.target === tab.target && candidate.kind === tab.kind)
  );
  if (existing !== undefined) {
    activeTabId.value = existing.id;
    activeFunction.value = existing.functionId;
    return;
  }
  openTabs.value = [...openTabs.value, tab];
  activeTabId.value = tab.id;
}
</script>

<template>
  <div class="app-shell" :style="shellStyle">
    <header class="titlebar">
      <button class="brand-cluster button-reset" type="button" @click="switchFunction('workspace')">
        <div class="product-mark">NF</div>
        <div>
          <p class="eyebrow">NovelFabric V4</p>
          <h1>Workspace Shell</h1>
        </div>
        <span class="badge badge-warning">{{
          bridgeHealth === "live" ? "Bridge Live" : "Offline Buffer"
        }}</span>
      </button>
      <div class="status-pills">
        <span class="pill cyan">Sidebar → Function</span>
        <span class="pill violet">Manager/File → Tab</span>
        <button class="pill blue button-reset" type="button" @click="openCompatibilityDocs">
          /mcp.md
        </button>
      </div>
    </header>

    <aside class="activity-rail" aria-label="Function navigation">
      <button
        v-for="entry in sidebarFunctions"
        :key="entry.id"
        :class="{ active: activeFunction === entry.id }"
        type="button"
        :aria-label="entry.label"
        :title="entry.label"
        @click="switchFunction(entry.id)"
      >
        <span class="rail-icon">{{ entry.icon }}</span>
        <span class="rail-label">{{ entry.label }}</span>
      </button>
    </aside>

    <aside class="sidebar">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Function</p>
          <h2>{{ activeFunctionMeta?.label }}</h2>
        </div>
        <span class="tiny-chip">sidebar</span>
      </div>
      <p class="function-description">{{ activeFunctionMeta?.description }}</p>

      <div class="sidebar-split">
        <section class="sidebar-pane file-pane">
          <div class="pane-title">
            <span>文件资源</span>
            <span class="pane-title-actions">
              <button class="pane-action" type="button" title="全部展开" @click="expandAll">
                展开
              </button>
              <button class="pane-action" type="button" title="全部收齐" @click="collapseAll">
                收齐
              </button>
            </span>
          </div>
          <label class="search-box">
            <span>Search</span>
            <input v-model="searchQuery" aria-label="Search workspace files" />
          </label>
          <p class="sidebar-hint">
            命中节点：{{ visibleWorkspaceRows.length }} / {{ workspaceRows.length }}
          </p>
          <div class="workspace-tree-list">
            <div
              v-for="row in visibleWorkspaceRows"
              :key="row.node.path"
              :class="['tree-row', row.node.kind, { selected: selectedFilePath === row.node.path }]"
            >
              <button
                class="tree-toggle"
                type="button"
                :disabled="row.node.kind !== 'directory'"
                :aria-expanded="
                  row.node.kind === 'directory' ? isExpanded(row.node.path) : undefined
                "
                :aria-label="`${isExpanded(row.node.path) ? '收起' : '展开'} ${row.node.path}`"
                @click.stop="toggleDirectoryExpand(row.node)"
              >
                {{ row.node.kind === "directory" ? (isExpanded(row.node.path) ? "▼" : "▶") : "" }}
              </button>
              <button class="tree-open-target" type="button" @click.stop="selectNode(row.node)">
                <span
                  class="tree-node-label"
                  :style="{ paddingLeft: `${(row.depth * 16).toString()}px` }"
                >
                  <span
                    :class="['file-icon', fileIconClass(row.node)]"
                    :aria-label="fileIconLabel(row.node)"
                  ></span>
                  {{ row.node.label }}
                </span>
                <span v-if="row.node.protected" class="lock">lock</span>
              </button>
            </div>
          </div>
        </section>
        <div
          class="resize-handle resize-handle-horizontal session-buffer-handle"
          role="separator"
          aria-label="Resize session buffer"
          @pointerdown="startResize('session', $event)"
        ></div>
        <section class="sidebar-pane session-pane">
          <div class="pane-title">
            <span>会话</span>
            <small>chat buffers</small>
          </div>
          <button
            v-for="session in chatSessions"
            :key="session.id"
            class="session-row"
            type="button"
            @click="toastMessage = `已切换会话 buffer：${session.label}`"
          >
            <span>{{ session.label }}</span>
            <small>{{ session.status }}</small>
          </button>
        </section>
      </div>
      <div
        class="resize-handle resize-handle-vertical sidebar-buffer-handle"
        role="separator"
        aria-label="Resize sidebar buffer"
        @pointerdown="startResize('sidebar', $event)"
      ></div>
    </aside>

    <main class="main-column">
      <div class="tabbar-shell">
        <nav
          class="tabbar"
          aria-label="Opened file and manager tabs"
          @wheel.prevent="scrollTabbarHorizontally"
        >
          <button
            v-for="tab in openTabs"
            :key="tab.id"
            :class="[
              'node-tab',
              {
                active: activeTabId === tab.id,
                locked: tab.locked === true,
                dirty: tab.kind === 'file' && draftForPath(tab.target).dirty
              }
            ]"
            type="button"
            @click="activateTab(tab)"
          >
            <span>{{
              tab.kind === "file" ? "file" : tab.kind === "rag-node" ? "rag" : "mgr"
            }}</span>
            {{ tab.label
            }}<strong v-if="tab.kind === 'file' && draftForPath(tab.target).dirty">•</strong>
            <i
              type="button"
              role="button"
              tabindex="0"
              aria-label="Close tab"
              @click.stop="closeTab(tab)"
              >×</i
            >
          </button>
          <span v-if="!hasOpenTabs" class="tabbar-empty"
            >没有打开的 tab；正在使用聊天 buffer。</span
          >
        </nav>
        <button
          class="tabbar-close-all"
          type="button"
          :disabled="!hasOpenTabs"
          @click="closeAllTabs"
        >
          关闭全部
        </button>
      </div>

      <section v-if="activeFunction === 'workspace'" class="view-stack">
        <template v-if="activeTab !== null && activeTab.kind === 'manager'">
          <article class="workspace-manager-card">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Directory Workbench</p>
                <h2>{{ activeDirectoryManager?.title }}</h2>
              </div>
              <code>{{ activeTab.target }}/</code>
            </div>
            <p class="manager-description">{{ activeDirectoryManager?.description }}</p>
          </article>

          <article v-if="activeDirectoryManager?.kind === 'files'" class="workspace-manager-card">
            <div class="manager-table">
              <div class="table-row table-head">
                <span>名称</span><span>类型</span><span>状态</span><span>路径</span>
              </div>
              <button
                v-for="row in activeDirectoryChildren"
                :key="row.node.path"
                class="table-row"
                type="button"
                @click="selectNode(row.node)"
              >
                <span>{{ row.node.label }}</span>
                <span>{{ row.node.kind }}</span>
                <span>{{ row.node.protected ? "protected" : "openable" }}</span>
                <code>{{ row.node.path }}</code>
              </button>
            </div>
          </article>

          <article
            v-if="activeDirectoryManager?.kind === 'workspace'"
            class="workspace-manager-card"
          >
            <div class="metric-grid">
              <button
                v-for="metric in workspaceMetrics"
                :key="metric.label"
                :class="['metric-card', metric.tone]"
                type="button"
                @click="
                  openWorkspacePath(
                    metric.label === 'Inbox'
                      ? 'imports/source'
                      : metric.label === 'Bridge'
                        ? 'agents'
                        : '.novelfabric'
                  )
                "
              >
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
              </button>
            </div>
            <div class="manager-grid dense-grid">
              <section>
                <h3>近期文件</h3>
                <button
                  class="manager-row"
                  type="button"
                  @click="selectNode({ label: 'project.md', path: 'project.md', kind: 'file' })"
                >
                  <span>project.md</span><small>主题与工作区约束</small>
                </button>
                <button
                  class="manager-row"
                  type="button"
                  @click="
                    selectNode({
                      label: 'branch-impact.md',
                      path: 'reports/branch-impact.md',
                      kind: 'file'
                    })
                  "
                >
                  <span>reports/branch-impact.md</span><small>分支影响报告草稿</small>
                </button>
              </section>
              <section>
                <h3>保护策略</h3>
                <p class="manager-note">
                  protected files 默认只读，真实写入必须经 CLI capability manifest 与审计。
                </p>
                <code>.novelfabric/capabilities.toml</code>
              </section>
            </div>
          </article>

          <article v-if="activeDirectoryManager?.kind === 'imports'" class="workspace-manager-card">
            <div class="pipeline-strip">
              <button type="button" @click="openWorkspacePath('imports/source')">
                source inbox
              </button>
              <button
                type="button"
                @click="toastMessage = 'decode 阶段会读取 imports/source/ 并规范化编码。'"
              >
                decode
              </button>
              <button
                type="button"
                @click="openWorkspacePath('writing/chapters/import-preview.md')"
              >
                chapter split
              </button>
              <button type="button" @click="openWorkspacePath('cards')">card extraction</button>
              <button type="button" @click="openWorkspacePath('reports/import-summary.md')">
                report
              </button>
            </div>
            <div class="manager-table">
              <div class="table-row table-head">
                <span>文件</span><span>状态</span><span>进度</span><span>目标</span>
              </div>
              <button
                v-for="job in importJobs"
                :key="job.fileName"
                class="table-row"
                type="button"
                @click="openWorkspacePath(job.targetPath)"
              >
                <span>{{ job.fileName }}</span
                ><span>{{ job.status }}</span
                ><span>{{ job.progress }}%</span><code>{{ job.targetPath }}</code>
              </button>
            </div>
          </article>

          <article v-if="activeDirectoryManager?.kind === 'source-inbox'" class="import-card">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Source Import Inbox</p>
                <h2>原始拆书文件</h2>
              </div>
              <code>imports/source/</code>
            </div>
            <div class="import-upload-row">
              <label class="upload-button">
                <span>选择小说文件</span>
                <input
                  accept=".txt,.md,text/plain,text/markdown"
                  type="file"
                  @change="stageSourceImport"
                />
              </label>
              <p>{{ importStatus }}</p>
            </div>
            <dl v-if="importUpload" class="import-target-panel">
              <dt>文件</dt>
              <dd>{{ importUpload.fileName }} · {{ importUpload.sizeLabel }}</dd>
              <dt>目标路径</dt>
              <dd>
                <code>{{ importUpload.targetPath }}</code>
              </dd>
              <dt>预览</dt>
              <dd>{{ importUpload.preview }}</dd>
            </dl>
            <div class="manager-grid dense-grid">
              <section>
                <h3>源文件队列</h3>
                <button
                  v-for="job in importJobs"
                  :key="job.fileName"
                  class="manager-row static-row"
                  type="button"
                  @click="openWorkspacePath(job.targetPath)"
                >
                  <span>{{ job.fileName }}</span
                  ><small>{{ job.encoding }} · {{ job.size }} · {{ job.warning }}</small>
                </button>
              </section>
              <section>
                <h3>拆书入口</h3>
                <p class="manager-note">
                  拆书任务由主 agent 通过 CLI 权限执行，不在 UI 侧预设规则。
                </p>
              </section>
            </div>
            <div class="chapter-preview-grid">
              <button
                v-for="chapter in chapterPreviews"
                :key="chapter.title"
                class="chapter-card"
                type="button"
                @click="openWorkspacePath(`writing/chapters/${chapter.title}.md`)"
              >
                <span>{{ chapter.status }}</span>
                <h3>{{ chapter.title }}</h3>
                <p>{{ chapter.words }} · {{ chapter.location }}</p>
                <small>{{ chapter.characters.join(" / ") }} · {{ chapter.risk }}</small>
              </button>
            </div>
          </article>

          <article v-if="activeDirectoryManager?.kind === 'cards'" class="workspace-manager-card">
            <div class="card-record-grid">
              <button
                v-for="card in cardRecords"
                :key="card.path"
                class="story-card-item"
                type="button"
                @click="openWorkspacePath(card.path)"
              >
                <span>{{ card.kind }}</span>
                <h3>{{ card.name }}</h3>
                <p>{{ card.status }} · {{ card.updated }}</p>
                <code>{{ card.path }}</code
                ><small>{{ card.evidence }}</small>
              </button>
            </div>
          </article>

          <article v-if="activeDirectoryManager?.kind === 'agents'" class="workspace-manager-card">
            <div class="manager-table">
              <div class="table-row table-head">
                <span>Agent</span><span>Asset</span><span>Capability</span><span>Path</span>
              </div>
              <button
                v-for="asset in agentAssets"
                :key="asset.path"
                class="table-row"
                type="button"
                @click="openWorkspacePath(asset.path)"
              >
                <span>{{ asset.agent }}</span
                ><span>{{ asset.asset }} <small v-if="asset.protected">locked</small></span
                ><span>{{ asset.capability }}</span
                ><code>{{ asset.path }}</code>
              </button>
            </div>
          </article>

          <article
            v-if="activeDirectoryManager?.kind === 'simulation'"
            class="workspace-manager-card"
          >
            <div class="timeline-list">
              <button
                v-for="turn in simulationTurns"
                :key="turn.round"
                class="timeline-item"
                type="button"
                @click="openWorkspacePath(turn.artifact)"
              >
                <strong>{{ turn.round }} · {{ turn.actor }}</strong>
                <p>{{ turn.action }}</p>
                <small>{{ turn.status }} → {{ turn.artifact }}</small>
              </button>
            </div>
          </article>

          <article v-if="activeDirectoryManager?.kind === 'reports'" class="workspace-manager-card">
            <div class="artifact-grid">
              <button
                v-for="report in reportRecords"
                :key="report.path"
                class="artifact-item"
                type="button"
                @click="openWorkspacePath(report.path)"
              >
                <span>{{ report.type }}</span>
                <h3>{{ report.name }}</h3>
                <p>{{ report.risk }} · {{ report.citations }} · {{ report.status }}</p>
                <code>{{ report.path }}</code>
              </button>
            </div>
          </article>

          <article
            v-if="activeDirectoryManager?.kind === 'scaffold'"
            class="workspace-manager-card"
          >
            <div class="manager-table">
              <div class="table-row table-head">
                <span>文件</span><span>状态</span><span>策略</span><span>路径</span>
              </div>
              <button
                v-for="record in scaffoldRecords"
                :key="record.path"
                class="table-row"
                type="button"
                @click="openWorkspacePath(record.path)"
              >
                <span>{{ record.name }}</span
                ><span>{{ record.status }}</span
                ><span>{{ record.policy }}</span
                ><code>{{ record.path }}</code>
              </button>
            </div>
          </article>
        </template>

        <article v-else-if="activeTab !== null" class="file-editor-card full-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">File Editor · {{ activeFileMode }}</p>
              <h2>{{ activeFilePath }}</h2>
            </div>
            <div class="editor-actions">
              <span :class="['tiny-chip', activeFileLocked ? 'locked-chip' : '']">
                {{ activeFileStatus }}
              </span>
              <button type="button" @click="reloadActiveFile">重读</button>
              <button
                class="primary-action compact-action"
                type="button"
                :disabled="activeFileLocked || !activeFileDraft.dirty || activeFileDraft.saving"
                @click="saveActiveFile"
              >
                保存
              </button>
            </div>
          </div>
          <p v-if="activeFileDraft.error" class="editor-error">{{ activeFileDraft.error }}</p>
          <p v-if="activeFileDraft.lastSavedAuditPath" class="editor-audit">
            最近审计记录：<code>{{ activeFileDraft.lastSavedAuditPath }}</code>
          </p>
          <div class="file-editor-layout">
            <label class="code-editor-pane">
              <span>源文本</span>
              <textarea
                v-model="activeFileContent"
                :readonly="activeFileLocked"
                spellcheck="false"
              />
            </label>
            <section class="rich-preview-pane">
              <div class="preview-toolbar">
                <strong>{{ selectedFile?.title ?? activeFilePath }}</strong>
                <small>{{ activeFileStatus }}</small>
              </div>
              <div
                v-if="activeFileMode === 'markdown'"
                class="markdown-rich-preview"
                v-html="markdownHtml"
              ></div>
              <div
                v-else-if="activeFileMode === 'json'"
                class="json-tree-preview"
                role="tree"
                aria-label="JSON visual tree"
              >
                <div class="json-preview-header" aria-hidden="true">
                  <span>Key</span>
                  <span>Type</span>
                  <span>Value</span>
                </div>
                <div
                  v-for="row in jsonPreview"
                  :key="row.id"
                  :class="['json-preview-row', `json-kind-${row.kind}`]"
                  role="treeitem"
                  :aria-level="row.depth + 1"
                >
                  <span
                    class="json-key-cell"
                    :style="{ paddingLeft: `${(row.depth * 18).toString()}px` }"
                  >
                    <span class="json-guide" aria-hidden="true">{{
                      row.depth === 0 ? "◆" : "└"
                    }}</span>
                    <span class="json-label">{{ row.label }}</span>
                  </span>
                  <code class="json-type-badge">{{ row.summary }}</code>
                  <code class="json-value-cell">{{ row.value }}</code>
                </div>
              </div>
              <pre v-else class="plain-text-preview"><code>{{ activeFileContent }}</code></pre>
              <blockquote v-if="selectedFile">Evidence: {{ selectedFile.evidence }}</blockquote>
            </section>
          </div>
        </article>
      </section>

      <section v-else-if="activeFunction === 'rag'" class="rag-layout">
        <article class="rag-graph-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Agent Cluster Visualization</p>
              <h2>MiroFish-like agent memory graph</h2>
            </div>
            <span class="tiny-chip">local editable nodes</span>
          </div>
          <div class="cluster-toolbar">
            <button type="button" @click="toggleClusterSimulation">
              {{ clusterIsRunning ? "暂停动态" : "启动动态" }}
            </button>
            <button type="button" @click="zoomCluster(0.15)">放大</button>
            <button type="button" @click="zoomCluster(-0.15)">缩小</button>
            <button type="button" @click="panCluster(-40, 0)">←</button>
            <button type="button" @click="panCluster(40, 0)">→</button>
            <button type="button" @click="panCluster(0, -40)">↑</button>
            <button type="button" @click="panCluster(0, 40)">↓</button>
            <button type="button" @click="resetClusterView">重置</button>
          </div>
          <div class="cluster-physics-panel">
            <label
              >吸引距离 <input v-model.number="linkDistance" type="range" min="60" max="520"
            /></label>
            <label
              >斥力 <input v-model.number="chargeStrength" type="range" min="-1800" max="-40"
            /></label>
            <label
              >向心力
              <input v-model.number="centerStrength" type="range" min="0" max="1" step="0.01"
            /></label>
            <label
              >碰撞半径 <input v-model.number="collisionRadius" type="range" min="20" max="220"
            /></label>
          </div>
          <svg
            class="rag-graph"
            viewBox="0 0 760 460"
            role="img"
            aria-label="Obsidian-like agent cluster graph visualization"
            @pointerdown="startClusterPan"
            @wheel.prevent="zoomCluster($event.deltaY < 0 ? 0.12 : -0.12)"
          >
            <g class="cluster-viewport" :transform="clusterTransform">
              <g v-for="edge in dynamicClusterEdges" :key="edge.id" class="rag-edge-group">
                <line class="rag-edge" :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2" />
                <text class="rag-edge-label" :x="edge.labelX" :y="edge.labelY" text-anchor="middle">
                  {{ edge.label }}
                </text>
              </g>
              <g
                v-for="node in clusterNodes"
                :key="node.id"
                class="rag-node-group"
                @click="selectRagNode(node)"
                @pointerdown="startClusterNodeDrag(node, $event)"
              >
                <circle
                  :class="['rag-node', node.kind, { selected: selectedRagNodeId === node.id }]"
                  :cx="node.x ?? 0"
                  :cy="node.y ?? 0"
                  r="42"
                  :fill="clusterNodeColor(node.kind)"
                />
                <text
                  class="rag-node-text"
                  :x="node.x ?? 0"
                  :y="(node.y ?? 0) + 5"
                  text-anchor="middle"
                >
                  {{ node.label }}
                </text>
              </g>
            </g>
          </svg>
        </article>
        <article class="rag-editor-card">
          <p class="eyebrow">Selected Cluster Node</p>
          <h2>{{ selectedRagNode?.label }}</h2>
          <p>{{ selectedRagNode?.summary }}</p>
          <code>{{ selectedRagNode?.filePath }}</code>
          <label class="rag-editor">
            <span>对应文件内容（受控文件草稿）</span>
            <textarea v-model="activeRagContent" rows="12" />
          </label>
          <button class="primary-action" type="button" @click="saveRagContent">保存到工作区</button>
          <div class="related-panel">
            <h3>关联节点</h3>
            <button
              v-for="node in relatedRagNodes"
              :key="node.id"
              type="button"
              @click="selectRagNode(node)"
            >
              {{ node.label }} · {{ node.filePath }}
            </button>
          </div>
        </article>
      </section>

      <section v-else-if="activeFunction === 'swarm'" class="view-stack">
        <article class="swarm-card full-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Selected Stage</p>
              <h2>{{ activeStage?.label }} · {{ selectedLane?.role }}</h2>
            </div>
            <button
              class="tiny-chip frozen button-reset"
              type="button"
              @click="openCompatibilityDocs"
            >
              /mcp.md
            </button>
          </div>
          <div class="stage-stepper">
            <button
              v-for="stage in stages"
              :key="stage.index"
              :class="['stage', { selected: activeStageIndex === stage.index }]"
              type="button"
              @click="selectStage(stage)"
            >
              <span>{{ stage.index }}</span>
              <strong>{{ stage.label }}</strong>
              <small>{{ stage.output }}</small>
            </button>
          </div>
          <div class="detail-panel">
            <h3>{{ activeStage?.label }}</h3>
            <p>{{ activeStage?.detail }}</p>
            <h3>{{ selectedLane?.role }}</h3>
            <p>{{ selectedLane?.detail }}</p>
          </div>
          <div class="lane-grid">
            <button
              v-for="lane in lanes"
              :key="lane.id"
              :class="['agent-lane', lane.accent, { selected: selectedLaneId === lane.id }]"
              type="button"
              @click="selectLane(lane)"
            >
              <span class="lane-status">{{ lane.status }}</span>
              <h3>{{ lane.role }}</h3>
              <p>{{ lane.capability }}</p>
            </button>
          </div>
        </article>
      </section>

      <section v-else-if="activeFunction === 'chat'" class="view-stack chat-view-stack">
        <article class="chat-card full-card chat-workspace-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Agent Runs Preview</p>
              <h2>本地 composer</h2>
            </div>
            <span class="tiny-chip">no backend</span>
          </div>
          <div class="chat-room-scroll">
            <article
              v-for="message in chatMessages"
              :key="message.id"
              :class="['chat-message', message.role]"
            >
              <div class="chat-avatar">{{ message.author.slice(0, 1) }}</div>
              <div class="chat-bubble">
                <div class="chat-message-meta">
                  <strong>{{ message.author }}</strong>
                  <span>{{ message.meta }}</span>
                </div>
                <p>{{ message.content }}</p>
              </div>
            </article>
          </div>
          <div class="composer-row openwebui-composer">
            <textarea v-model="promptText" aria-label="Workspace task prompt" rows="4" />
            <button class="primary-action" type="button" @click="submitPreviewRun">发送</button>
          </div>
        </article>
      </section>

      <section v-else-if="activeFunction === 'api'" class="view-stack">
        <article class="api-card full-card">
          <p class="eyebrow">Compatibility Surface</p>
          <h2>Frozen External Swarm Contract</h2>
          <p>
            Endpoint names, MCP tools, response fields, idempotency, and artifact path semantics
            remain compatible with prior clients.
          </p>
          <div class="endpoint-list">
            <button
              v-for="endpoint in frozenEndpoints"
              :key="endpoint.name"
              :class="['endpoint-row', { selected: selectedEndpointName === endpoint.name }]"
              type="button"
              @click="selectEndpoint(endpoint)"
            >
              <code>{{ endpoint.name }}</code>
              <span>{{ endpoint.detail }}</span>
            </button>
          </div>
          <div class="field-cloud all-fields">
            <span v-for="field in immutableFields" :key="field">{{ field }}</span>
          </div>
        </article>
      </section>

      <section v-else class="view-stack">
        <article class="full-card editor-card">
          <p class="eyebrow">{{ activeFunctionMeta?.label }}</p>
          <h2>{{ activeTab?.label }}</h2>
          <p class="function-description">{{ activeFunctionMeta?.description }}</p>
          <div class="detail-panel">
            该功能作为管理器节点打开；需要写入项目事实时必须经过 CLI-backed bridge。
          </div>
        </article>
      </section>

      <section
        v-if="activeFunction !== 'chat'"
        class="chat-buffer"
        aria-label="Primary chat buffer"
      >
        <div
          class="resize-handle resize-handle-horizontal chat-buffer-handle"
          role="separator"
          aria-label="Resize chat buffer"
          @pointerdown="startResize('chat', $event)"
        ></div>
        <div class="chat-buffer-header">
          <div>
            <p class="eyebrow">Primary Chat Buffer</p>
            <h2>跑团操作入口</h2>
          </div>
          <span>像 VSCode 终端一样固定在工作区底部</span>
        </div>
        <div class="chat-room-scroll compact-stream">
          <article
            v-for="message in chatMessages"
            :key="message.id"
            :class="['chat-message', message.role]"
          >
            <div class="chat-avatar">{{ message.author.slice(0, 1) }}</div>
            <div class="chat-bubble">
              <div class="chat-message-meta">
                <strong>{{ message.author }}</strong>
                <span>{{ message.meta }}</span>
              </div>
              <p>{{ message.content }}</p>
            </div>
          </article>
        </div>
        <div class="composer-row openwebui-composer">
          <textarea v-model="promptText" aria-label="Workspace task prompt" rows="3" />
          <button class="primary-action" type="button" @click="submitPreviewRun">发送</button>
        </div>
      </section>

      <p class="toast" role="status">{{ toastMessage }}</p>
    </main>

    <aside class="inspector">
      <div
        class="resize-handle resize-handle-vertical inspector-buffer-handle"
        role="separator"
        aria-label="Resize inspector buffer"
        @pointerdown="startResize('inspector', $event)"
      ></div>
      <article class="inspector-card">
        <p class="eyebrow">Semantic Path</p>
        <h2>Sidebar → Function → Manager → Tab</h2>
        <p>当前功能：{{ activeFunctionMeta?.label }}</p>
        <p>当前 tab：{{ activeTab?.label }}</p>
      </article>
      <article class="inspector-card">
        <p class="eyebrow">Selection</p>
        <h2>{{ activeFunction === "rag" ? selectedRagNode?.label : selectedFile?.title }}</h2>
        <p v-if="activeFunction === 'rag'">{{ selectedRagNode?.filePath }}</p>
        <p v-else>{{ selectedFile?.path }}</p>
      </article>
      <article class="inspector-card">
        <p class="eyebrow">Capability Manifest</p>
        <dl>
          <dt>Main agent</dt>
          <dd>project.manage, knowledge.query, report.render</dd>
          <dt>Role agent</dt>
          <dd>memory.recall, simulation.append_turn</dd>
          <dt>Denied by default</dt>
          <dd>external_swarm.run, files.patch_protected</dd>
        </dl>
      </article>
      <article class="inspector-card command-card">
        <p class="eyebrow">CLI launch</p>
        <code>novelfabric web bridge --workspace &lt;path&gt; --port 50023 --actor main_agent</code>
        <span>{{
          bridgeHealth === "live"
            ? "CLI-backed workspace bridge connected"
            : "Offline buffer; no disk writes"
        }}</span>
      </article>
    </aside>
  </div>
</template>
