---
description: 重启 claude-mem Worker 服务
shell: *!command* taskkill /F $1 /T

查找并终止占用端口 37777 的 claude-mem Worker 进程，然后插件会在下次需要时自动启动新的 Worker。

使用方法：
/restart-worker

此命令会：
1. 检测占用端口 37777 的进程
2. 解析进程 ID (PID)
3. 使用 taskkill /F 终止进程

适用平台：
- Windows（推荐）
- Linux/macOS（需手动终止）

注意：
- 重启后，插件会在下一次 hook 调用时自动启动 Worker
- 如需查看 Worker 状态，访问 http://127.0.0.1:37777/api/health
