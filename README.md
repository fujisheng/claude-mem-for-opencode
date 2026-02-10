# Claude-Mem for OpenCode

🧠 将 [claude-mem](https://github.com/thedotmack/claude-mem) 的持久化记忆能力带到 OpenCode

## ✨ AI 自动安装

**复制以下指令，发送给 AI：**

```
请从 https://github.com/fujisheng/claude-mem-for-opencode.git 安装 claude-mem 插件
```

AI 会读取 [doc/install-for-ai.md](./doc/install-for-ai.md) 并自动完成所有配置（克隆、安装、配置、验证），无需手动操作！

---

## 功能特性

- 🔄 **自动捕获** - 自动记录工具执行和对话历史
- 🔍 **智能搜索** - 使用自然语言搜索过去的记忆
- 📝 **上下文注入** - 自动将相关历史注入到系统提示
- 💾 **持久化存储** - SQLite + FTS5 全文搜索
- 🤖 **AI 处理** - 自动压缩和提取关键信息
- 🎯 **渐进式检索** - 3 层检索模式节省 token

---

## 快速开始

### 方式一：AI 自动安装（推荐）

**用户操作：**
1. 打开 OpenCode
2. **复制这句话给 AI：**
   ```
   请从 https://github.com/fujisheng/claude-mem-for-opencode.git 安装 claude-mem 插件
   ```
3. 等待 AI 完成安装（约 2-5 分钟）
4. 根据提示重启 OpenCode

**AI 会自动执行：**
- ✅ 克隆本仓库到 `.opencode/plugins/claude-mem-for-opencode/`
- ✅ 安装上游 claude-mem
- ✅ 配置 opencode.json
- ✅ 验证安装

### 方式二：手动安装

如果你希望手动安装：

```bash
# 1. 克隆仓库
git clone https://github.com/fujisheng/claude-mem-for-opencode.git .opencode/plugins/claude-mem-for-opencode

# 2. 安装上游依赖
cd .opencode/plugins/claude-mem-for-opencode/doc
node install-upstream.cjs

# 3. 配置 OpenCode（详见下方配置章节）

# 4. 重启 OpenCode
```

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

AI 会自动在 \`opencode.json\` 中添加：

```json
{
  "plugin": [
    "./.opencode/plugins/claude-mem-for-opencode"
  ],
  "mcp": {
    "mem-search": {
      "type": "local",
      "command": [
        "node",
        ".opencode/skills/mem-search/bootstrap.cjs"
      ],
      "environment": {
        "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
        "CLAUDE_MEM_WORKER_PORT": "37777"
      },
      "enabled": true
    }
  }
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

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OpenCode      │     │  Claude-Mem     │     │   Upstream      │
│   Platform      │────▶│   Plugin        │────▶│   Worker        │
│                 │     │                 │     │   (Port 37777)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         │              │  SQLite + FTS5  │              │
         └─────────────▶│  ~/.claude-mem/ │◀─────────────┘
                        └─────────────────┘
```

---

## 更新上游代码

对 AI 说：
```
请从 https://github.com/fujisheng/claude-mem-for-opencode.git 更新 claude-mem 插件
```

或手动执行：
```bash
cd .opencode/plugins/claude-mem-for-opencode/doc
node update-upstream.cjs
```

然后重启 OpenCode。

---

## 目录结构

```
.
├── doc/                              # 安装脚本和文档
│   ├── install-for-ai.md             # AI 安装指令
│   ├── install-upstream.cjs          # 上游安装脚本
│   ├── update-upstream.cjs           # 更新脚本
│   └── ...
├── src/                              # TypeScript 源码
│   ├── index.ts                      # 插件主入口
│   ├── services/                     # 服务层
│   ├── storage/                      # 存储层
│   └── types/                        # 类型定义
├── vendor/                           # 上游代码（自动克隆，GitHub 上无此目录）
│   └── claude-mem/                   # 原始 claude-mem
├── LICENSE
├── README.md
├── package.json
└── tsconfig.json
```

---

## 故障排除

### 工具调用失败

1. 检查 Worker 是否运行：
   ```bash
   curl http://127.0.0.1:37777/api/health
   ```

2. 查看日志：
   ```bash
   tail -f ~/.claude-mem/logs/claude-mem-$(date +%Y-%m-%d).log
   ```

3. 重新安装：
   ```bash
   node .opencode/plugins/claude-mem-for-opencode/doc/install-upstream.cjs
   ```

### 端口冲突

如果 37777 端口被占用，修改 \`opencode.json\`：
```json
{
  "env": {
    "CLAUDE_MEM_WORKER_PORT": "37778"
  }
}
```

---

## 系统要求

- **Node.js**: >= 18.0.0
- **Bun**: >= 1.0.0（推荐，性能更好）
- **Git**: 任何版本

---

## 开发

### 构建插件

```bash
cd .opencode/plugins/claude-mem-for-opencode
npm install
npm run build
```

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

**快速开始**：复制 `请从 https://github.com/fujisheng/claude-mem-for-opencode.git 安装 claude-mem 插件` 发送给 AI 即可！🚀
