---
name: mem-search
description: 记忆系统检索助手 - 指导 3 层检索工作流，高效搜索和获取历史记忆，避免 token 浪费
license: MIT
compatibility: opencode
metadata:
  workflow: memory-retrieval
  tools: search, timeline, get_observations, save_memory
---

## What I do

- 指导正确的 3 层检索工作流（节省 10x token）
- 执行记忆搜索（语义搜索 + FTS5 全文回退）
- 获取时间线上下文
- 按 ID 获取完整记录详情
- 手动保存重要记忆

## When to use me

- 需要搜索历史对话、决策、研究记录时
- 需要了解某个记忆前后的上下文时
- 需要获取完整记忆详情时
- 需要手动保存重要信息供未来参考时
- **不确定如何高效使用记忆系统时**

## 自动触发条件

**AI 应在以下情况主动加载此技能：**

| 触发场景 | 关键词示例 | 行为 |
|----------|-----------|------|
| 用户询问历史记录 | "之前做过什么"、"上次怎么处理的"、"历史上有类似的问题吗" | 自动搜索相关记忆 |
| 用户提到过去的决策 | "为什么选择这个方案"、"之前讨论过"、"记得吗" | 搜索决策记录 |
| 跨会话延续工作 | "继续上次的工作"、"之前做到哪了" | 获取上次会话上下文 |
| 调试已知问题 | "这个 bug 之前出现过"、"老问题又来了" | 搜索历史 bugfix 记录 |
| 重复性问题 | "我们不是讨论过吗"、"又碰到这个了" | 搜索相关记忆避免重复工作 |
| 不确定上下文 | AI 发现当前任务可能与历史相关但缺乏上下文 | 主动搜索补充上下文 |

### 主动调用示例

```typescript
// 用户: "之前我们在技能系统上做了什么？"
// AI 应自动:
skill({ name: "mem-search" })
search({ query: "技能系统", project: "Client" })

// 用户: "这个 bug 好像之前修过"
// AI 应自动:
skill({ name: "mem-search" })
search({ query: "bug fix", type: "🔴" })

// 用户: "继续上次的工作"
// AI 应自动:
skill({ name: "mem-search" })
timeline({ anchor: "recent", depth_before: 10, depth_after: 0 })
```

### 判断逻辑

```
如果 用户消息包含以下模式:
  - "之前" + "做过/讨论/处理/遇到"
  - "上次" + "怎么/是什么/在哪"
  - "记得" + "吗/有没有"
  - "继续" + "上次/之前"
  - "历史" + "记录/上下文"
  - "老问题" / "又来了" / "重复"
  
那么:
  1. 主动加载 mem-search 技能
  2. 执行 search() 查找相关记忆
  3. 根据需要获取 timeline 或详情
  4. 在回复中引用找到的历史信息
```

## 核心工作流

### 3 层检索模式（必须遵循）

```
Layer 1: search(query)      → 获取索引和 ID（~50-100 tokens/结果）
Layer 2: timeline(anchor)   → 获取上下文（中量，看前后关联）
Layer 3: get_observations() → 获取完整详情（按需，token 消耗大）
```

> **重要**: 不要跳过前两步直接获取详情。3 层模式可节省 10x token。

### 工作流示例

```typescript
// 步骤 1: 搜索获取 ID 列表
search({ query: "authentication bug", limit: 10 })
// 返回: | #123 | 2026-03-15 | 🔴 | auth error fix | Client |

// 步骤 2: 获取时间线上下文
timeline({ anchor: 123, depth_before: 3, depth_after: 3 })
// 返回: 该记录前后的相关记忆

// 步骤 3: 仅获取真正需要的完整详情
get_observations({ ids: [123, 125] })
// 返回: 完整的记忆内容
```

## 可用工具

### search - 搜索记忆

```typescript
search({
  query: string,      // 搜索关键词
  limit?: number,     // 结果数量（默认 20）
  offset?: number,    // 分页偏移
  type?: string,      // 类型过滤（如 "🔴", "🟣", "🔵"）
  obs_type?: string,  // 观测类型
  project?: string,   // 项目过滤
  dateStart?: string, // 开始日期
  dateEnd?: string,   // 结束日期
  orderBy?: string,   // 排序方式
})
```

**返回格式**:
```
| ID | Date | T | Title | Read | Work |
|----|------|---|-------|------|------|
| #123 | 2026-03-15 | 🔴 | auth error fix | ~200 | 🛠️ 5000 |
```

### timeline - 获取时间线上下文

```typescript
timeline({
  anchor: number,      // 锚点 ID
  depth_before?: number, // 向前深度（默认 5）
  depth_after?: number,  // 向后深度（默认 5）
  project?: string,    // 项目过滤
  query?: string,      // 或用查询定位锚点
})
```

**用途**: 了解某条记忆的上下文，看看之前做了什么、之后做了什么。

### get_observations - 获取完整详情

```typescript
get_observations({
  ids: number[],      // 必须：ID 数组
  limit?: number,
  orderBy?: string,
  project?: string,
})
```

**注意**: 此工具返回完整内容，token 消耗大。仅在确定需要详情时使用。

### save_memory - 手动保存记忆

```typescript
save_memory({
  text: string,       // 必须：记忆内容
  title?: string,     // 可选：标题
  project?: string,   // 可选：项目名
})
```

**用途**: 手动保存重要信息，如：
- 关键决策
- Bug 根因
- 重要发现
- 需要跨会话记住的信息

## 记忆类型图标

| 图标 | 类型 | 说明 |
|------|------|------|
| 🔴 | bugfix | Bug 修复记录 |
| 🟣 | feature | 新功能开发 |
| 🔄 | refactor | 重构记录 |
| ✅ | change | 变更记录 |
| 🔵 | discovery | 发现/研究记录 |
| ⚖️ | decision | 决策记录 |

## 隐私保护

使用 `<private>...</private>` 标签保护敏感信息：

```
用户: 请检查 API 密钥 <private>sk-xxx</private> 是否正确
```

标签内的内容不会被记录到记忆系统。

## 常见问题

### Q: 语义搜索返回空结果怎么办？

A: 插件会自动回退到 FTS5 全文搜索。如果仍然没有结果：
- 尝试不同的关键词
- 检查项目名是否正确
- 使用更通用的搜索词

### Q: 如何查看特定时间段的记忆？

```typescript
search({
  query: "bug",
  dateStart: "2026-03-01",
  dateEnd: "2026-03-15"
})
```

### Q: 如何只看某个项目的记忆？

```typescript
search({
  query: "authentication",
  project: "Client"
})
```

### Q: Worker 未就绪怎么办？

1. 检查 Bun 是否安装: `bun --version`
2. 检查端口 37777 是否被占用
3. 使用 `/restart-worker` 命令重启 Worker

## 技术细节

### 数据存储

- 位置: `~/.claude-mem/claude-mem.db`
- 格式: SQLite + FTS5 全文索引
- Worker: Bun 运行时，端口 37777

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_MEM_WORKER_PORT` | 37777 | Worker 端口 |
| `CLAUDE_MEM_WORKER_HOST` | 127.0.0.1 | Worker 主机 |
| `CLAUDE_MEM_DATA_DIR` | ~/.claude-mem | 数据目录 |
