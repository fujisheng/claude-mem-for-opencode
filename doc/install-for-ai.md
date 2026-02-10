# AI 安装指令 - Claude-Mem for OpenCode

> **仓库地址**：https://github.com/fujisheng/claude-mem-for-opencode.git
> **作用**：指导 AI 一步一步完成插件安装和配置

---

## 🎯 触发条件

当用户说以下任意一句话时，执行本安装流程：

- "帮我安装 claude-mem"
- "安装记忆插件"
- "配置 claude-mem"
- "setup claude-mem"
- "我想使用记忆功能"
- "请从 https://github.com/fujisheng/claude-mem-for-opencode.git 安装 claude-mem 插件"

---

## 🚀 安装步骤（按顺序执行）

### 步骤 1：环境检查

**1.1 检查 Node.js 版本**
```bash
node --version
```
要求：>= 18.0.0

**1.2 检查 Git**
```bash
git --version
```
要求：已安装

如果缺少依赖，提示用户安装后再继续。

---

### 步骤 2：克隆仓库

**2.1 检查是否已存在**
```bash
if [ -d ".opencode/plugins/claude-mem-for-opencode" ]; then
  echo "插件目录已存在，更新代码..."
  cd .opencode/plugins/claude-mem-for-opencode
  git pull origin main
else
  echo "创建目录并克隆..."
  mkdir -p .opencode/plugins
  git clone https://github.com/fujisheng/claude-mem-for-opencode.git .opencode/plugins/claude-mem-for-opencode
fi
```

**2.2 进入插件目录**
```bash
cd .opencode/plugins/claude-mem-for-opencode
```

---

### 步骤 3：安装插件依赖

在插件目录执行：
```bash
npm install
```

这会安装插件运行所需的依赖包。

---

### 步骤 4：安装上游 claude-mem

**4.1 执行安装脚本**
```bash
cd doc
node install-upstream.cjs
```

这个脚本会自动：
- ✅ 检查系统依赖（Node.js、Git）
- ✅ 克隆上游 claude-mem 仓库
- ✅ 安装 npm 依赖
- ✅ 构建项目
- ✅ 验证安装

**如果安装失败**：
1. 检查错误信息
2. 尝试手动安装：
   ```bash
   cd .opencode/plugins/claude-mem-for-opencode/vendor
   git clone https://github.com/thedotmack/claude-mem.git
   cd claude-mem
   npm install
   npm run build
   ```

### 步骤 5：配置 OpenCode

检查项目根目录是否存在 `opencode.json`：

#### 情况 A：文件不存在
创建 `opencode.json`：
```json
{
  "$schema": "https://opencode.ai/config.json",
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

#### 情况 B：文件已存在
读取现有 `opencode.json`，添加以下内容：

1. 在 `plugin` 数组中添加：
   ```json
   "./.opencode/plugins/claude-mem-for-opencode"
   ```

2. 在 `mcp` 对象中添加：
   ```json
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
    ```

---

### 步骤 6：创建 MCP Skill 配置

**直接复制 skill 文件夹到正确位置：**

```bash
# 创建父目录
mkdir -p .opencode/skills

# 复制整个 skill/mem-search 文件夹
cp -r .opencode/plugins/claude-mem-for-opencode/skill/mem-search .opencode/skills/
```

**或者使用 Windows 命令：**
```powershell
# PowerShell
New-Item -ItemType Directory -Force -Path .opencode\skills
Copy-Item -Recurse -Force .opencode\plugins\claude-mem-for-opencode\skill\mem-search .opencode\skills\
```

复制后，skill 目录结构应该是：
```
.opencode/skills/mem-search/
├── bootstrap.cjs      # MCP 启动脚本
├── mcp.json           # MCP 配置
└── SKILL.md           # Skill 文档
```

### 步骤 7：验证配置

检查 `opencode.json` 是否有效：
- 确保 JSON 格式正确
- 确保路径 `./.opencode/plugins/claude-mem-for-opencode` 存在
- 确保 `mcp.json` 路径正确

### 步骤 8：最终验证

验证以下文件是否存在：
- ✅ `.opencode/plugins/claude-mem-for-opencode/src/index.ts` (插件源码)
- ✅ `.opencode/plugins/claude-mem-for-opencode/vendor/claude-mem/plugin/scripts/worker-service.cjs` (Worker 服务)
- ✅ `.opencode/plugins/claude-mem-for-opencode/vendor/claude-mem/plugin/scripts/mcp-server.cjs` (MCP 服务器)
- ✅ `.opencode/skills/mem-search/bootstrap.cjs` (启动脚本)
- ✅ `.opencode/skills/mem-search/mcp.json` (Skill 配置)
- ✅ `.opencode/skills/mem-search/SKILL.md` (Skill 文档) ⭐
- ✅ `opencode.json` (OpenCode 主配置)

---

## 📢 通知用户

安装完成后，向用户展示以下信息：

```
✅ Claude-Mem 插件安装完成！

📦 已安装组件：
   • 上游代码 (claude-mem)
   • OpenCode 插件适配层
   • MCP Skill 配置

⚙️ 配置位置：
   • opencode.json - OpenCode 主配置
   • ~/.claude-mem/ - 数据存储目录

🚀 使用方法：
   • search(query="关键词") - 搜索记忆
   • save_memory(text="内容", title="标题") - 手动保存
   • timeline(anchor=ID) - 查看上下文
   • get_observations(ids=[ID]) - 获取详情

⚠️  重要：需要重启 OpenCode 才能生效！
   请关闭当前会话并重新启动。
```

---

## 🔄 更新插件

当用户要求更新时：

```bash
# 1. 拉取最新代码
cd .opencode/plugins/claude-mem-for-opencode
git pull origin main

# 2. 更新依赖
npm install

# 3. 更新上游
cd doc
node update-upstream.cjs

# 4. 通知用户重启
echo "✅ 更新完成！请重启 OpenCode 以使用新版本。"
```

---

## 🐛 故障排除

### 问题 1：Worker 无法启动

**症状**：工具调用返回 "claude-mem worker is not available"

**解决方案**：
1. 检查端口是否被占用：
   ```bash
   # Windows
   netstat -ano | findstr 37777
   
   # Linux/macOS
   lsof -i :37777
   ```

2. 检查上游是否正确安装：
   ```bash
   ls .opencode/plugins/claude-mem-for-opencode/vendor/claude-mem/plugin/scripts/
   ```

3. 重新安装：
   ```bash
   cd .opencode/plugins/claude-mem-for-opencode/doc
   node install-upstream.cjs
   ```

### 问题 2：Hook 不工作

**症状**：工具执行没有被自动记录

**解决方案**：
1. 检查 `opencode.json` 中是否正确注册了插件：
   ```json
   "plugin": ["./.opencode/plugins/claude-mem"]
   ```

2. 检查插件是否正确加载（查看 OpenCode 启动日志）

3. 重启 OpenCode

### 问题 3：构建失败

**症状**：`npm run build` 报错

**解决方案**：
1. 清理并重新安装：
   ```bash
   cd .opencode/plugins/claude-mem-for-opencode/vendor/claude-mem
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   ```

2. 检查 Node.js 版本：
   ```bash
   node --version  # 需要 >= 18
   ```

---

## 📝 验证清单

安装完成后，请验证以下功能：

- [ ] Worker 健康检查通过
  ```bash
  curl http://127.0.0.1:37777/api/health
  ```
  应返回：`{"status": "ok"}`

- [ ] MCP 工具可用
  ```
  __IMPORTANT()
  ```
  应返回 3 层工作流文档

- [ ] 手动保存工作
  ```
  save_memory(text="测试", title="测试")
  ```
  应返回成功消息

- [ ] 搜索功能工作
  ```
  search(query="测试")
  ```
  应返回搜索结果

---

## 🔗 相关文件

- **安装脚本**：`.opencode/plugins/claude-mem-for-opencode/doc/install-upstream.cjs`
- **更新脚本**：`.opencode/plugins/claude-mem-for-opencode/doc/update-upstream.cjs`
- **MCP 配置**：`.opencode/skills/mem-search/mcp.json`

---

## 🎓 架构说明

本插件采用双层架构：

1. **OpenCode 适配层** (`claude-mem-for-opencode/src/`)
   - 事件钩子（session.created, tool.execute 等）
   - MCP 工具定义
   - Worker 管理

2. **上游 Worker** (`claude-mem-for-opencode/vendor/claude-mem/`)
   - HTTP API 服务（端口 37777）
   - AI 处理
   - SQLite 存储

两者通过 HTTP 通信，适配层将 OpenCode 事件转换为上游 API 调用。

---

**版本**：1.0.0  
**更新日期**：2026-02-10  
**兼容**：OpenCode >= 1.0, claude-mem >= 9.0
