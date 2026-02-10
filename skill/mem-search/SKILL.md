---
name: mem-search
description: Search through Claude's persistent memory to find relevant context from past coding sessions. Use natural language queries to locate previous observations, summaries, and insights.
license: MIT
compatibility: opencode
metadata:
  version: "1.0.0"
  author: "Claude-Mem for OpenCode"
  category: "memory"
---

# mem-search Skill

Search through your coding session history to find relevant context and insights.

## When to Use

Use this skill when you need to:
- Find information about previous work on a feature or bug
- Understand past architectural decisions
- Recall specific implementations or patterns used before
- Get context about a codebase from previous sessions

## How to Search
本技能提供两种使用方式：

1. **直接调用工具（推荐）**：直接使用 `search / timeline / get_observations / save_memory / __IMPORTANT` 工具。
2. **通过 skill_mcp 调用**：先加载本技能，再用 `skill_mcp` 调用名为 `mem-search` 的 MCP 服务器（适合你想显式走 MCP 的场景）。

### 方式 1：直接调用工具（推荐）
Use the `mem_search` tool with natural language queries:

search(query="authentication bug", type="bugfix", limit=10)
timeline(query="authentication", depth_before=2, depth_after=2)
get_observations(ids=[123, 456, 789])
save_memory(text="API 需要 Authorization header", title="API Auth")
__IMPORTANT()
mem_search(query="API endpoints", limit=5)
```
### 方式 2：skill_mcp（需要先加载技能）

```
skill(name="mem-search")
```

然后调用 MCP：

```
skill_mcp(mcp_name="mem-search", tool_name="search", arguments="{\"query\":\"authentication\",\"limit\":5}")
skill_mcp(mcp_name="mem-search", tool_name="timeline", arguments="{\"query\":\"authentication\",\"depth_before\":2,\"depth_after\":2}")
skill_mcp(mcp_name="mem-search", tool_name="get_observations", arguments="{\"ids\":[123,456]}")
skill_mcp(mcp_name="mem-search", tool_name="save_memory", arguments="{\"text\":\"API 需要 Authorization header\",\"title\":\"API Auth\"}")
```



For efficient token usage, follow this 3-layer approach:

1. **Search** - Get compact results with IDs
2. **Timeline** - See context around interesting results  
3. **Details** - Fetch full content for relevant items

### Step 1: Search

```
search(query="login bug", limit=10)
```

Returns: `[OBSERVATION] 2024-01-15 10:30:15 - Fixed authentication bug in login flow...`

### Step 2: Timeline (Optional)

If you find an interesting observation (ID: 123):

```
timeline(anchor=123, depth_before=5, depth_after=5)
```

Shows what happened before and after that observation.

### Step 3: Save Important Insights

```
save_memory(text="Authentication requires JWT token in Authorization header", title="Auth Pattern")
```

## Search Types

- **all** (default) - Search observations, summaries, and prompts
- **observation** - Tool executions and their results
- **summary** - Session summaries and manual notes
- **prompt** - User queries from past sessions

## Examples

**Find recent bug fixes:**
```
search(query="fixed bug", type="bugfix", limit=20)
```

**Recall architecture decisions:**
```
search(query="architecture decision", type="decision", limit=10)
```

**Find work on specific files:**
```
search(query="UserController.ts", limit=20)
```

**Get context around a known observation:**
```
timeline(anchor=123, depth_before=3, depth_after=3)
```

## Privacy Notes

- Content marked with `<private>` tags is excluded from storage
- Use `<private>...</private>` to wrap sensitive information
- Confidential data should not be included in observations

## Available Tools

1. `search` - 搜索索引（返回轻量结果/ID）
2. `timeline` - 获取某个结果前后上下文
3. `get_observations` - 批量拉取详情（用 ID）
4. `save_memory` - 手动保存记忆
5. `__IMPORTANT` - 工作流说明（3 层渐进式检索）
