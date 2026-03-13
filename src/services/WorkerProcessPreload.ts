// Windows 下让上游 StdioClientTransport 识别为 Electron 环境，
// 从而启用其内置 windowsHide 逻辑，避免启动阶段弹出空白控制台。
if (process.platform === "win32")
{
	var processWithOptionalType = process as NodeJS.Process & { type?: string };
	if (processWithOptionalType.type === undefined)
	{
		processWithOptionalType.type = "opencode";
	}
}
