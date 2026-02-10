# AI 自动安装指令 - Claude-Mem for OpenCode

> **目标**：AI 自动完成从克隆到配置的所有步骤，无需用户手动操作
> **仓库地址**：https://github.com/fujisheng/claude-mem-for-opencode.git

---

## 🎯 触发条件

当用户说以下任意一句话时，执行本安装流程：

- "帮我安装 claude-mem"
- "安装记忆插件"
- "配置 claude-mem"
- "setup claude-mem"
- "我想使用记忆功能"
- "安装 claude-mem-for-opencode"
- "请从 https://github.com/fujisheng/claude-mem-for-opencode.git 安装 claude-mem 插件"
- "从 https://github.com/fujisheng/claude-mem-for-opencode 安装"

**本文档位置**：本文件位于仓库根目录的 `AI-INSTALL.md`，AI 应据此执行安装步骤。

---

## 🚀 自动安装流程

### 步骤 1：环境检查

**1.1 检查当前目录**
```bash
pwd
```

确认当前工作目录。插件将安装到：
- 当前目录下的 `.opencode/plugins/claude-mem/`
- 当前目录下的 `.opencode/skills/mem-search/`

**1.2 检查系统依赖**
```bash
node --version  # 需要 >= 18.0.0
git --version   # 需要安装
```

如果缺少依赖，提示用户：
> "需要先安装 Node.js (>= 18) 和 Git。请访问 https://nodejs.org/ 安装 Node.js"

---

### 步骤 2：自动克隆仓库

**2.1 检查是否已存在**
```bash
if [ -d ".opencode/plugins/claude-mem" ]; then
  echo "插件目录已存在，执行更新流程"
  cd .opencode/plugins/claude-mem
  git pull origin main
else
  echo "克隆新仓库..."
  mkdir -p .opencode/plugins
  git clone https://github.com/fujisheng/claude-mem-for-opencode.git .opencode/plugins/claude-mem
fi
```

**2.2 创建 Skill 目录结构**
```bash
mkdir -p .opencode/skills/mem-search
```

**2.3 复制 Skill 配置文件**
```bash
cp .opencode/plugins/claude-mem/.opencode/skills/mem-search/bootstrap.cjs .opencode/skills/mem-search/
cp .opencode/plugins/claude-mem/.opencode/skills/mem-search/mcp.json.example .opencode/skills/mem-search/mcp.json
```

---

### 步骤 3：安装上游依赖

**3.1 执行自动安装脚本**
```bash
cd .opencode/plugins/claude-mem/.opencode
node install-upstream.cjs
```

这个脚本会自动：
- ✅ 检查系统依赖（Node.js、Git、Bun）
- ✅ 克隆上游 claude-mem 仓库到 vendor/
- ✅ 安装 npm 依赖
- ✅ 构建项目
- ✅ 验证安装

**3.2 等待安装完成**
安装过程可能需要 2-5 分钟，显示进度信息给用户。

**3.3 检查安装结果**
验证以下文件是否存在：
- `.opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/worker-service.cjs`
- `.opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/mcp-server.cjs`
- `.opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/worker-wrapper.cjs`

---

### 步骤 4：配置 OpenCode

**4.1 检查现有配置**
```bash
if [ -f "opencode.json" ]; then
  echo "opencode.json 已存在，需要合并配置"
else
  echo "创建新的 opencode.json"
fi
```

**4.2 创建/更新 opencode.json**

如果文件不存在，创建：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./.opencode/plugins/claude-mem"
  ],
  "mcp": {
    "mem-search": {
      "type": "local",
      "command": [
        "node",
        ".opencode/skills/mem-search/bootstrap.cjs"
      ],
      "env": {
        "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
        "CLAUDE_MEM_WORKER_PORT": "37777"
      },
      "enabled": true
    }
  },
  "permission": {
    "skill": {
      "*": "allow"
    }
  }
}
```

如果文件已存在，读取并合并：
- 在 `plugin` 数组中添加 `"./.opencode/plugins/claude-mem"`
- 在 `mcp` 对象中添加 `mem-search` 配置

**4.3 创建 MCP Skill 配置**
```bash
cat > .opencode/skills/mem-search/mcp.json << 'EOF'
{
  "mcpServers": {
    "mem-search": {
      "command": "node",
      "args": [
        ".opencode/skills/mem-search/bootstrap.cjs"
      ],
      "env": {
        "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
        "CLAUDE_MEM_WORKER_PORT": "37777"
      },
      "enabled": true
    }
  }
}
EOF
```

---

### 步骤 5：验证安装

**5.1 检查文件完整性**
```bash
# 检查插件代码
if [ ! -f ".opencode/plugins/claude-mem/src/index.ts" ]; then
  echo "错误：插件源码缺失"
  exit 1
fi

# 检查上游构建产物
if [ ! -f ".opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/worker-service.cjs" ]; then
  echo "错误：上游 Worker 未构建"
  exit 1
fi

# 检查启动脚本
if [ ! -f ".opencode/skills/mem-search/bootstrap.cjs" ]; then
  echo "错误：MCP 启动脚本缺失"
  exit 1
fi

# 检查配置文件
if [ ! -f "opencode.json" ]; then
  echo "错误：opencode.json 未创建"
  exit 1
fi
```

**5.2 显示安装摘要**
```
✅ Claude-Mem for OpenCode 安装完成！

📦 已安装组件：
   • 插件代码: .opencode/plugins/claude-mem/
   • 上游 Worker: .opencode/plugins/claude-mem/vendor/claude-mem/
   • MCP 配置: .opencode/skills/mem-search/
   • OpenCode 配置: opencode.json

⚙️ 配置详情：
   • Worker 端口: 37777
   • 数据目录: ~/.claude-mem/
   • 日志目录: ~/.claude-mem/logs/

🚀 使用方法：
   • search(query="关键词") - 搜索历史记忆
   • save_memory(text="内容", title="标题") - 手动保存
   • timeline(anchor=ID) - 查看时间线上下文
   • get_observations(ids=[ID]) - 获取详细记录

⚠️  重要提示：
   需要重启 OpenCode 才能生效！
   请关闭当前会话并重新启动。

📖 文档链接：
   • 使用指南: https://github.com/fujisheng/claude-mem-for-opencode#readme
   • 故障排除: 见下方故障排除章节
```

---

## 🔄 更新流程

当用户要求更新时：

```bash
# 1. 拉取最新代码
cd .opencode/plugins/claude-mem
git pull origin main

# 2. 更新上游代码
cd .opencode
node update-upstream.cjs

# 3. 通知用户重启
echo "✅ 更新完成！请重启 OpenCode 以使用新版本。"
```

---

## 🐛 故障排除

### 问题 1：克隆失败

**症状**：`git clone` 报错

**解决方案**：
1. 检查网络连接
2. 检查 Git 是否安装：
   ```bash
   git --version
   ```
3. 如果权限问题，使用 HTTPS：
   ```bash
   git clone https://github.com/fujisheng/claude-mem-for-opencode.git
   ```

### 问题 2：安装脚本失败

**症状**：`install-upstream.cjs` 报错

**解决方案**：
1. 检查 Node.js 版本（需要 >= 18）：
   ```bash
   node --version
   ```

2. 手动安装上游：
   ```bash
   cd .opencode/plugins/claude-mem
   mkdir -p vendor
   cd vendor
   git clone https://github.com/thedotmack/claude-mem.git
   cd claude-mem
   npm install
   npm run build
   ```

### 问题 3：端口冲突

**症状**：Worker 无法启动，37777 端口被占用

**解决方案**：
1. 修改 `opencode.json` 和 `.opencode/skills/mem-search/mcp.json`：
   ```json
   {
     "env": {
       "CLAUDE_MEM_WORKER_PORT": "37778"
     }
   }
   ```

### 问题 4：Hook 不工作

**症状**：工具执行没有被自动记录

**解决方案**：
1. 确认 `opencode.json` 中包含：
   ```json
   "plugin": ["./.opencode/plugins/claude-mem"]
   ```

2. 检查 Worker 是否运行：
   ```bash
   curl http://127.0.0.1:37777/api/health
   ```

3. 重启 OpenCode

### 问题 5：权限错误

**症状**：Windows 上脚本无法执行

**解决方案**：
1. 以管理员身份运行 OpenCode
2. 或使用 PowerShell 手动执行安装步骤

---

## 📝 验证清单

安装完成后，AI 应该验证：

- [ ] 仓库已克隆到 `.opencode/plugins/claude-mem/`
- [ ] 上游代码已安装到 `vendor/claude-mem/`
- [ ] 构建产物存在（worker-service.cjs, mcp-server.cjs）
- [ ] `opencode.json` 已创建/更新
- [ ] `.opencode/skills/mem-search/` 已配置
- [ ] 用户已收到重启提示

---

## 🎓 工作原理

```
用户指令
    ↓
AI 自动执行：
  1. git clone https://github.com/fujisheng/claude-mem-for-opencode.git
  2. node install-upstream.cjs
  3. 配置 opencode.json
  4. 验证安装
    ↓
重启 OpenCode
    ↓
插件自动加载：
  • 启动 Worker (port 37777)
  • 注册事件钩子
  • 启用 MCP 工具
    ↓
正常使用：
  • 自动捕获工具执行
  • 搜索历史记忆
  • 上下文注入
```

---

## 📚 相关链接

- **本仓库**：https://github.com/fujisheng/claude-mem-for-opencode
- **上游仓库**：https://github.com/thedotmack/claude-mem
- **OpenCode 文档**：https://opencode.ai/docs

---

**版本**：1.0.0  
**更新日期**：2026-02-10  
**作者**：fujisheng
