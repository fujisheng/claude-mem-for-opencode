# AI 安装指令 - Claude-Mem for OpenCode

> **仓库地址**：https://github.com/fujisheng/claude-mem-for-opencode.git
> **作用**：指导 AI 一步一步完成插件安装和配置

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

**1.3 检查 Bun（必需）**

```bash
bun --version
```

要求：>= 1.0.0

**安装 Bun**：

```bash
curl -fsSL https://bun.sh/install | bash
```

或访问 https://bun.sh 获取其他安装方式。

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

### 步骤 3：安装插件依赖并构建

在插件目录执行：

```bash
npm install
npm run build
```

- `npm install` 安装插件运行所需的依赖包
- `npm run build` 将 TypeScript 源码（`src/`）编译到 `dist/`

> ⚠️ **`npm run build` 是必须步骤！** OpenCode 通过 `package.json` 的 `"main": "dist/index.js"` 加载编译后的代码。如果跳过构建，插件不会生效。

---

### 步骤 4：安装上游 claude-mem

**4.1 执行安装脚本（带版本锁定）**

```bash
cd doc
node install-upstream.cjs --tag v10.0.1
```

> **注意**：`--tag` 参数指定上游版本，确保稳定性。可用版本请查看 https://github.com/thedotmack/claude-mem/tags

这个脚本会自动：

- ✅ 检查系统依赖（Node.js、Git、Bun）
- ✅ 克隆上游 claude-mem 仓库（指定版本）
- ✅ 使用 Bun 安装依赖
- ✅ 构建项目
- ✅ 验证安装

**如果安装失败**：

1. 检查错误信息
2. 尝试手动安装：
   ```bash
   cd .opencode/plugins/claude-mem-for-opencode/vendor
   git clone --branch v10.0.1 --single-branch https://github.com/thedotmack/claude-mem.git
   cd claude-mem
   bun install
   bun run build
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
  ]
}
```

#### 情况 B：文件已存在

读取现有 `opencode.json`，在 `plugin` 数组中添加：

```json
"./.opencode/plugins/claude-mem-for-opencode"
```

---

### 步骤 6：安装 mem-search 技能

插件自带 `mem-search` 技能，用于指导 AI 高效使用记忆系统。需要将其拷贝到技能目录。

**6.1 检查技能目录是否存在**

```bash
# 项目级技能目录
mkdir -p .opencode/skills

# 全局技能目录（可选，如需跨项目使用）
mkdir -p ~/.config/opencode/skills
```

**6.2 拷贝技能到项目级目录**

```bash
# 将 mem-search 技能拷贝到项目技能目录
cp -r .opencode/plugins/claude-mem-for-opencode/skill/mem-search .opencode/skills/
```

**6.3 （可选）拷贝到全局目录**

如需在所有项目中使用此技能：

```bash
cp -r .opencode/plugins/claude-mem-for-opencode/skill/mem-search ~/.config/opencode/skills/
```

**6.4 验证技能已安装**

```bash
ls .opencode/skills/mem-search/SKILL.md
```

应显示文件路径，表示安装成功。

---

### 步骤 7：验证配置

检查 `opencode.json` 是否有效：

- 确保 JSON 格式正确
- 确保路径 `./.opencode/plugins/claude-mem-for-opencode` 存在
- 确保 `dist/index.js` 已生成（说明构建步骤已执行）

### 步骤 8：最终验证

验证以下文件是否存在：

- ✅ `.opencode/plugins/claude-mem-for-opencode/dist/index.js` (编译后的插件入口)
- ✅ `.opencode/plugins/claude-mem-for-opencode/src/index.ts` (插件源码)
- ✅ `.opencode/plugins/claude-mem-for-opencode/vendor/claude-mem/plugin/scripts/worker-service.cjs` (Worker 服务)
- ✅ `.opencode/plugins/claude-mem-for-opencode/skill/mem-search/SKILL.md` (mem-search 技能源文件)
- ✅ `.opencode/skills/mem-search/SKILL.md` (已安装的技能)
- ✅ `opencode.json` (OpenCode 主配置，包含 plugin 路径)

---

## 📢 通知用户

安装完成后，向用户展示以下信息：

```
✅ Claude-Mem 插件安装完成！

📦 已安装组件：
   • 上游代码 (claude-mem v10.0.1)
   • OpenCode 插件适配层
   • mem-search 技能（记忆检索助手）

⚙️ 配置位置：
   • opencode.json - OpenCode 主配置
   • ~/.claude-mem/ - 数据存储目录
   • .opencode/skills/mem-search/ - 记忆检索技能

🚀 使用方法：
   • search(query="关键词") - 搜索记忆
   • save_memory(text="内容", title="标题") - 手动保存
   • timeline(anchor=ID) - 查看上下文
   • get_observations(ids=[ID]) - 获取详情

📚 mem-search 技能：
   • 当你说"之前"、"上次"、"继续上次"等关键词时
   • AI 会自动加载此技能并搜索历史记忆
   • 使用 3 层检索模式节省 token

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

# 2. 更新依赖并重新构建
npm install
npm run build

# 3. 更新上游（指定新版本）
cd doc
node install-upstream.cjs --tag v10.0.2  # 替换为最新版本

# 4. 更新技能（如有更新）
cp -r ../skill/mem-search ../../../skills/mem-search/

# 5. 通知用户重启
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
   node install-upstream.cjs --tag v10.0.1
   ```

### 问题 2：Hook 不工作

**症状**：工具执行没有被自动记录

**解决方案**：

1. 检查 `opencode.json` 中是否正确注册了插件：

   ```json
   "plugin": ["./.opencode/plugins/claude-mem-for-opencode"]
   ```
2. 检查 `dist/index.js` 是否存在（如不存在需运行 `npm run build`）
3. 检查插件是否正确加载（查看 OpenCode 启动日志）
4. 重启 OpenCode

### 问题 3：Bun 未安装

**症状**：安装脚本报错 `bun: command not found`

**解决方案**：

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 重新打开终端或 source 配置
source ~/.bashrc  # 或 ~/.zshrc

# 验证安装
bun --version
```

### 问题 4：构建失败

**症状**：`bun run build` 报错

**解决方案**：

1. 清理并重新安装：

   ```bash
   cd .opencode/plugins/claude-mem-for-opencode/vendor/claude-mem
   rm -rf node_modules bun.lockb
   bun install
   bun run build
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

---

## 🎓 架构说明

本插件采用双层架构：

1. **OpenCode 适配层** (`src/` → `dist/`)

   - 事件钩子（`session.created`, `chat.message`, `tool.execute` 等）
   - 上下文注入（双重机制：`chat.message` synthetic part + `system.transform` 备用）
   - 自定义工具定义（search, timeline, get_observations, save_memory）
   - Worker 进程管理

2. **上游 Worker** (`vendor/claude-mem/`)

   - HTTP API 服务（端口 37777）
   - AI 处理（压缩、摘要）
   - SQLite + FTS5 存储

两者通过 HTTP 通信，适配层将 OpenCode 事件转换为上游 API 调用。

> **关键**：`src/` 目录是 TypeScript 源码，必须通过 `npm run build` 编译到 `dist/` 后才能被 OpenCode 加载。

---

**版本**：2.2.0
**更新日期**：2026-03-18
**兼容**：OpenCode >= 1.0, claude-mem >= 10.0, Bun >= 1.0
