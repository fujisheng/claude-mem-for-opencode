# Claude-Mem 插件快速安装指南
# 用于 AI 自动安装和配置
# 版本: 1.0.0

## 🎯 任务概述

为 Opencode 安装和配置 claude-mem 上游集成。

## 📋 前置检查

在开始之前，请检查以下依赖是否已安装：

1. **Node.js** (必需，版本 >= 18)
   - 检查: `node --version`
   - 安装: https://nodejs.org/

2. **Bun** (强烈推荐，性能更好)
   - 检查: `bun --version`
   - 安装: https://bun.sh/

3. **Git** (用于拉取上游代码)
   - 检查: `git --version`

## 🚀 安装步骤

### 步骤 1: 创建目录结构

```bash
cd .opencode/plugins/claude-mem/.opencode
node install-upstream.cjs
```

### 步骤 2: 拉取上游代码

```bash
cd .opencode/plugins/claude-mem/vendor
git clone https://github.com/thedotmack/claude-mem.git
```

### 步骤 3: 安装依赖

```bash
cd claude-mem
npm install
```

### 步骤 4: 构建项目

```bash
npm run build
```

等待构建完成。这会生成以下文件：
- `plugin/scripts/worker-service.cjs`
- `plugin/scripts/worker-wrapper.cjs`
- `plugin/scripts/mcp-server.cjs`

### 步骤 5: 验证安装

检查以下文件是否存在：
- ✅ `.opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/worker-service.cjs`
- ✅ `.opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/worker-wrapper.cjs`
- ✅ `.opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/mcp-server.cjs`

## 🔄 更新上游代码

当上游有更新时，执行以下步骤：

```bash
cd .opencode/plugins/claude-mem/vendor/claude-mem
git pull origin main
npm install
npm run build
```

**注意**: 更新后需要重启 MCP 服务器才能生效。

## ⚙️ 配置说明

### MCP 配置

确保 `.opencode/skills/mem-search/mcp.json` 配置正确：

```json
{
  "mcpServers": {
    "mem-search": {
      "command": "node",
      "args": [
        "c:\\Users\\fujis\\Desktop\\workspace\\AlienExodus\\Client\\.opencode\\skills\\mem-search\\bootstrap.cjs"
      ],
      "env": {
        "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
        "CLAUDE_MEM_WORKER_PORT": "37777"
      },
      "enabled": true
    }
  }
}
```

### 环境变量

可以设置以下环境变量（可选）：

- `CLAUDE_MEM_WORKER_PORT`: Worker 服务端口（默认：37777）
- `CLAUDE_MEM_WORKER_HOST`: Worker 服务主机（默认：127.0.0.1）
- `CLAUDE_MEM_DATA_DIR`: 数据目录（默认：~/.claude-mem）

## ✅ 验证测试

安装完成后，运行以下测试：

### 测试 1: 检查 Worker 健康状态

```bash
curl http://127.0.0.1:37777/api/health
```

期望输出：
```json
{"status": "ok"}
```

### 测试 2: 使用 MCP 工具

尝试调用工具：
```
__IMPORTANT()
```

应该返回 3 层工作流文档。

### 测试 3: 保存记忆

```
save_memory(text="测试安装成功", title="安装测试")
```

应该返回成功消息。

## 🔧 故障排除

### 问题 1: Worker 无法启动

**症状**: 工具调用返回 "claude-mem worker is not available"

**解决方案**:
1. 检查 37777 端口是否被其他程序占用
2. 检查 Bun 是否已安装: `bun --version`
3. 检查上游代码是否已正确构建
4. 查看日志: `~/.claude-mem/logs/worker-*.log`

### 问题 2: 构建失败

**症状**: `npm run build` 报错

**解决方案**:
1. 确保 Node.js 版本 >= 18: `node --version`
2. 删除 node_modules 重新安装:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
3. 检查是否有权限问题（Windows 上以管理员运行）

### 问题 3: MCP 工具调用超时

**症状**: 工具调用长时间无响应

**解决方案**:
1. 检查 Worker 是否正在运行
2. 重启 MCP 服务器
3. 检查防火墙设置

## 📚 相关文件

- **详细配置**: `.opencode/plugins/claude-mem/.opencode/claude-mem-setup.yaml`
- **适配代码**: `.opencode/plugins/claude-mem/src/`
- **上游代码**: `.opencode/plugins/claude-mem/vendor/claude-mem/`
- **MCP 配置**: `.opencode/skills/mem-search/mcp.json`
- **引导脚本**: `.opencode/skills/mem-search/bootstrap.cjs`

## 🔗 参考链接

- 上游仓库: https://github.com/thedotmack/claude-mem
- 上游文档: https://docs.claude-mem.ai
- Opencode 文档: https://opencode.ai/docs
