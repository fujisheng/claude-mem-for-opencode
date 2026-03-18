---
description: 重启 claude-mem Worker 服务
shell: *!command* powershell -NoProfile -ExecutionPolicy Bypass -File ".opencode/plugins/claude-mem-for-opencode/commands/restart-worker.ps1"

安全重启 claude-mem Worker 服务（Windows）：

- 优先读取 `~/.claude-mem/opencode-worker-state/*.json` 识别受管 Worker PID
- 兜底扫描 37777-37796 端口，仅处理命令行可验证归属本插件的 Worker
- 清理对应 state 文件和残留 lock 目录
- 插件会在下次需要时自动拉起新的 Worker

使用方法：
/restart-worker

此命令会：
1. 识别本插件受管的 Worker 进程（避免误杀非插件进程）
2. 强制终止已验证归属的 Worker PID
3. 清理 worker state/lock 残留

适用平台：
- Windows

注意：
- 重启后，插件会在下一次 hook 调用时自动启动 Worker
- Worker 运行端口可能不是固定 37777（例如故障回退后为 37778）
- 可通过 `search()` 或 `save_memory()` 等工具触发自动拉起
