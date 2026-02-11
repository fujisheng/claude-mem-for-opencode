# Claude Mem for OpenCode

OpenCode 插件，将 [claude-mem](https://github.com/thedotmack/claude-mem) 的持久记忆功能集成到 OpenCode 中。

## 功能简介

🧠 将 [claude-mem](https://github.com/thedotmack/claude-mem) 的持久化记忆能力带到 OpenCode

## ✨ AI 自动安装

**复制以下指令，发送给 AI：**

```
Install and configure claude-mem-for-opencode by following the instructions here:
https://raw.githubusercontent.com/fujisheng/claude-mem-for-opencode/refs/heads/main/doc/install-for-ai.md
```

AI 会读取安装指令并自动完成所有配置（克隆、构建、安装上游、配置、验证），无需手动操作！

---

## 功能特性

- 🔄 **自动捕获** - 自动记录工具执行和对话历史
- 🔍 **智能搜索** - 使用自然语言搜索过去的记忆（支持 FTS5 全文检索回退）
- 📝 **上下文注入** - 会话首条消息时自动注入历史记忆到对话中（双重注入机制）
- 💾 **持久化存储** - SQLite + FTS5 全文搜索，数据位于 `~/.claude-mem/`
- 🤖 **AI 处理** - 自动压缩和提取关键信息
- 🎯 **渐进式检索** - 3 层检索模式节省 token
- 🔒 **隐私保护** - `<private>...</private>` 标签内的内容不会被记录

---

## 快速开始

### 方式一：AI 自动安装（推荐）

**用户操作：**
1. 打开 OpenCode
2. **复制这段指令给 AI：**
   ```
   Install and configure claude-mem-for-opencode by following the instructions here:
   https://raw.githubusercontent.com/fujisheng/claude-mem-for-opencode/refs/heads/main/doc/install-for-ai.md
   ```
3. 等待 AI 完成安装（约 2-5 分钟）
4. 根据提示重启 OpenCode

**AI 会自动执行：**
- ✅ 克隆本仓库到 `.opencode/plugins/claude-mem-for-opencode/`
- ✅ 安装依赖并构建（`npm install` + `npm run build`）
- ✅ 安装上游 claude-mem
- ✅ 配置 opencode.json
- ✅ 验证安装

### 方式二：手动安装

如果你希望手动安装：

```bash
# 1. 克隆仓库
git clone https://github.com/fujisheng/claude-mem-for-opencode.git .opencode/plugins/claude-mem-for-opencode

# 2. 安装插件依赖并构建
cd .opencode/plugins/claude-mem-for-opencode
npm install
npm run build

# 3. 安装上游 claude-mem
cd doc
node install-upstream.cjs --tag v10.0.1

# 4. 配置 OpenCode（详见下方配置章节）

# 5. 重启 OpenCode
```

> ⚠️ **重要**：修改 `src/` 下的 TypeScript 源码后，必须运行 `npm run build` 重新编译到 `dist/`，否则改动不会生效。

## 可用工具

| 工具 | 功能 |
|------|------|
| `search` | 搜索记忆（支持语义搜索 + FTS5 全文回退） |
| `timeline` | 获取某条记录前后的时间线上下文 |
| `get_observations` | 按 ID 批量获取观测记录详情 |
| `save_memory` | 手动保存重要记忆 |
| `__IMPORTANT` | 显示 3 层检索工作流文档 |

### 3 层检索模式

```
1. search(query) → 获取索引和 ID（轻量）
2. timeline(anchor=ID) → 获取上下文（中量）
3. get_observations([IDs]) → 获取完整详情（按需）
```

> 不要跳过前两步直接获取详情，3 层模式可节省 10x token。

---

## 隐私标签

在对话中使用 `<private>...</private>` 标签，内容不会被记录到记忆中：

```
用户: 请帮我检查这段代码 <private>公司内部API密钥: sk-xxx</private> 是否有问题
```

标签内的内容会被自动过滤，不会进入记忆系统。

---

## 使用方法

### 搜索记忆

```
search(query="authentication bug", limit=10)
```

### 获取上下文

```
timeline(anchor=123, depth_before=5, depth_after=5)
```

### 手动保存

```
save_memory(text="API 需要 Authorization header", title="API Auth")
```

### 获取详情

```
get_observations(ids=[123, 456])
```

---

## 配置说明

### 自动配置

AI 会自动在 `opencode.json` 中添加：

```json
{
  "plugin": [
    "./.opencode/plugins/claude-mem-for-opencode"
  ]
}
```

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| \`CLAUDE_MEM_WORKER_PORT\` | \`37777\` | Worker 服务端口 |
| \`CLAUDE_MEM_WORKER_HOST\` | \`127.0.0.1\` | Worker 服务主机 |
| \`CLAUDE_MEM_DATA_DIR\` | \`~/.claude-mem\` | 数据存储目录 |

---

## 工作原理

### 架构

```
OpenCode → Plugin (适配层) → HTTP API → claude-mem Worker → SQLite/FTS5
```

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OpenCode      │     │  Claude-Mem     │     │   Upstream      │
│   Platform      │────▶│   Plugin        │────▶│   Worker        │
│                 │     │  (适配层)       │     │   (Port 37777)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │                       │
                                ▼                       │
                       ┌─────────────────┐              │
                       │  SQLite + FTS5  │              │
                       │  ~/.claude-mem/ │◀─────────────┘
                       └─────────────────┘
```

### 上下文注入机制（双重保障）

插件使用两个 hook 实现上下文注入，共享同一个 `injectedSessionIds` 集合确保只注入一次：

| 注入点 | Hook | 机制 | 优先级 |
|--------|------|------|--------|
| 主注入 | `chat.message` | 以 `synthetic: true` 的 part 注入到用户消息中（对 TUI 隐藏，LLM 可见） | 先触发 |
| 备用注入 | `experimental.chat.system.transform` | 追加到系统提示词数组中 | 后触发（如主注入已成功则跳过） |

> **注意**：`synthetic: true` 的内容不会在 TUI 界面显示，但 LLM 能收到。可以让 AI 确认是否收到 `<claude-mem-context>` 来验证注入是否生效。

### 生命周期事件映射

| OpenCode 事件 | 上游 API | 功能 |
|---------------|----------|------|
| `session.created` | - | 重置注入状态，启动 Worker |
| `chat.message`（首次） | `GET /api/context/inject` | 注入历史记忆上下文 |
| `chat.message`（每次） | `POST /api/sessions/init` | 记录用户 prompt |
| `tool.execute.after` | `POST /api/sessions/observations` | 记录工具使用 |
| `session.compacting` | `POST /api/sessions/summarize` | 会话压缩时总结 |
| `session.deleted` | `POST /api/sessions/complete` | 标记会话完成 |
| `session.idle` | `POST /api/sessions/{id}/idle` | 记录空闲状态 |
| `session.error` | `POST /api/observation` | 记录错误 |

---

## 许可证

AGPL-3.0（与原版 claude-mem 一致）

---

## 致谢

- [claude-mem](https://github.com/thedotmack/claude-mem) - 原版项目
- [OpenCode](https://opencode.ai) - AI 编程平台

## 相关链接

- 📖 [原版文档](https://docs.claude-mem.ai)
- 🔧 [OpenCode 文档](https://opencode.ai/docs)
- 🐛 [提交 Issue](https://github.com/fujisheng/claude-mem-for-opencode/issues)

---

**快速开始**：复制上方 AI 自动安装指令发送给 AI 即可！
