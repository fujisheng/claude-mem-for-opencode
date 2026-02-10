# AI 执行手册 - Claude-Mem 上游集成
# 版本: 1.0.0
# 目标: 让 AI 能够自动完成 claude-mem 上游的集成、安装和更新

## 📖 概述

本文档指导 AI 如何自动管理 claude-mem 上游依赖。当用户要求"安装 claude-mem"或"更新上游"时，AI 应该按照以下流程执行。

## 🎯 工作流程

### 场景 1: 首次安装（从无到有）

**触发条件**: 用户说"安装 claude-mem"、"配置上游"等

**执行步骤**:

1. **读取配置**
   ```
   读取文件: .opencode/plugins/claude-mem/.opencode/claude-mem-setup.yaml
   读取文件: .opencode/plugins/claude-mem/.opencode/INSTALL.md
   ```

2. **检查当前状态**
   ```bash
   检查是否存在: .opencode/plugins/claude-mem/vendor/claude-mem/
   如果已存在 → 执行"更新流程"
   如果不存在 → 执行"安装流程"
   ```

3. **执行安装**（使用自动脚本）
   ```bash
   cd .opencode/plugins/claude-mem/.opencode
   node install-upstream.cjs
   ```

4. **验证安装**
   ```bash
   检查文件是否存在:
   - vendor/claude-mem/plugin/scripts/worker-service.cjs
   - vendor/claude-mem/plugin/scripts/worker-wrapper.cjs
   - vendor/claude-mem/plugin/scripts/mcp-server.cjs
   ```

5. **通知用户**
   - 安装完成
   - 提醒重启 Opencode 以加载新配置

### 场景 2: 更新上游代码

**触发条件**: 用户说"更新上游"、"更新 claude-mem"等

**执行步骤**:

1. **执行更新脚本**
   ```bash
   cd .opencode/plugins/claude-mem/.opencode
   node update-upstream.cjs
   ```

2. **提醒用户重启**
   - 更新完成
   - 需要重启 Opencode 才能使用新版本

### 场景 3: 检查上游版本

**触发条件**: 用户问"上游版本是多少"、"检查更新"等

**执行步骤**:

1. **获取版本信息**
   ```bash
   cd .opencode/plugins/claude-mem/vendor/claude-mem
   git describe --tags --always
   git log --oneline -5
   ```

2. **检查远程更新**
   ```bash
   git fetch origin
   git log HEAD..origin/main --oneline
   ```

3. **告知用户**
   - 当前版本
   - 是否有可用更新
   - 如何更新

## 📁 关键文件映射

| 文件路径 | 用途 |
|---------|------|
| `.opencode/plugins/claude-mem/.opencode/claude-mem-setup.yaml` | 完整配置规格 |
| `.opencode/plugins/claude-mem/.opencode/INSTALL.md` | 快速安装指南 |
| `.opencode/plugins/claude-mem/.opencode/install-upstream.cjs` | **自动安装脚本** |
| `.opencode/plugins/claude-mem/.opencode/update-upstream.cjs` | **自动更新脚本** |
| `.opencode/plugins/claude-mem/vendor/claude-mem/` | 上游代码安装位置 |
| `.opencode/skills/mem-search/mcp.json` | MCP 服务器配置 |

## 🔧 故障排除指南

当用户报告问题时，AI 应该：

### 问题: "工具调用失败"

1. 检查 Worker 文件是否存在
   ```bash
   ls .opencode/plugins/claude-mem/vendor/claude-mem/plugin/scripts/
   ```

2. 检查上游是否正确安装
   ```bash
   cd .opencode/plugins/claude-mem/vendor/claude-mem
   git status
   ```

3. 如果文件缺失 → 重新运行安装脚本

### 问题: "Worker 无法启动"

1. 检查 Bun 是否安装
   ```bash
   bun --version
   ```

2. 检查端口 37777 是否被占用
   ```bash
   # Windows
   netstat -ano | findstr 37777
   
   # Linux/macOS
   lsof -i :37777
   ```

3. 查看日志
   ```bash
   ls ~/.claude-mem/logs/
   ```

### 问题: "如何更新到最新版本"

直接执行：
```bash
cd .opencode/plugins/claude-mem/.opencode
node update-upstream.cjs
```

然后提醒用户重启 Opencode。

## 💡 最佳实践

### 安装时

- ✅ 优先使用自动脚本 `install-upstream.cjs`
- ✅ 检查依赖是否满足（Node.js、Git）
- ✅ 验证构建产物是否生成
- ✅ 提醒用户重启

### 更新时

- ✅ 使用 `update-upstream.cjs` 脚本
- ✅ 保留用户的本地配置
- ✅ 检查更新后的兼容性
- ⚠️ 总是提醒用户重启服务

### 日常维护

- ✅ 定期提醒用户更新上游（每月一次）
- ✅ 检查上游 release notes 了解新功能
- ✅ 保留安装日志便于故障排除

## 📝 示例对话

### 示例 1: 用户要求安装

**用户**: "帮我安装 claude-mem"

**AI**: 
1. 检查当前状态
2. 发现未安装
3. 执行: `node install-upstream.cjs`
4. 验证成功
5. 回复：
   ```
   ✅ Claude-Mem 上游集成已安装完成！
   
   版本: v9.1.1
   位置: .opencode/plugins/claude-mem/vendor/claude-mem/
   
   ⚠️  请重启 Opencode 以加载新配置。
   
   重启后可以测试：
   - __IMPORTANT()
   - search(query="test")
   ```

### 示例 2: 用户要求更新

**用户**: "更新上游代码"

**AI**:
1. 执行: `node update-upstream.js`
2. 显示更新前后的版本
3. 回复：
   ```
   ✅ 上游代码已更新！
   
   从: v9.1.1
   到: v9.2.0
   
   ⚠️  重要：需要重启 Opencode 才能使用新版本。
   ```

## 🎓 技术细节

### 上游仓库
- **URL**: https://github.com/thedotmack/claude-mem
- **分支**: main
- **构建命令**: `npm run build`
- **构建产物**: `plugin/scripts/*.cjs`

### 依赖要求
- **Node.js**: >= 18.0.0
- **Bun**: >= 1.0.0（推荐）
- **Git**: 任何版本

### 服务配置
- **Worker 端口**: 37777
- **Worker 主机**: 127.0.0.1
- **数据目录**: ~/.claude-mem/

## 🔗 相关链接

- 上游仓库: https://github.com/thedotmack/claude-mem
- 上游文档: https://docs.claude-mem.ai
- Opencode MCP 文档: https://opencode.ai/docs

---

**版本**: 1.0.0  
**最后更新**: 2026-02-10  
**作者**: Claude-Mem for OpenCode
