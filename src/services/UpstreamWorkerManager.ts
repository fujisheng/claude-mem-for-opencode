import { createHash } from "crypto";
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";

interface WorkerState
{
	pid: number | null;
	port: number;
	workerPath: string;
	version: string | null;
	managed: boolean;
	updatedAt: number;
}

interface WorkerHealthInfo
{
	pid: number | null;
	port: number;
	workerPath: string | null;
	version: string | null;
	managed: boolean;
	status: string | null;
}

interface ProcessInfo
{
	pid: number;
	commandLine: string | null;
	createdAt: string | null;
}

export interface UpstreamWorkerManagerOptions
{
	scriptPath: string;
	preferredPort: number;
	enablePortFallback: boolean;
	startupTimeoutMs: number;
}

export class UpstreamWorkerManager
{
	private readonly options: UpstreamWorkerManagerOptions;
	private activePort: number | null;
	private startInFlight: Promise<number> | null;
	private lastStartAttemptEpochMs: number;
	private hasValidatedBunRuntime: boolean;
	private lastFailedStartEpochMs: number;
	private readonly startFailureCooldownMs: number;
	private readonly workerPreloadPath: string;
	private readonly stateFilePath: string;
	private readonly startupLockPath: string;
	private bunExecutablePath: string | null;

	public constructor(options: UpstreamWorkerManagerOptions)
	{
		this.options = options;
		this.activePort = null;
		this.startInFlight = null;
		this.lastStartAttemptEpochMs = 0;
		this.hasValidatedBunRuntime = false;
		this.lastFailedStartEpochMs = 0;
		this.startFailureCooldownMs = process.platform === "win32" ? 120000 : 5000;
		this.workerPreloadPath = fileURLToPath(new URL("./WorkerProcessPreload.js", import.meta.url));
		this.stateFilePath = this.buildWorkerStateFilePath(options.scriptPath);
		this.startupLockPath = `${this.stateFilePath}.lock`;
		this.bunExecutablePath = null;
	}

	public getPort(): number
	{
		if (this.activePort === null)
		{
			return this.options.preferredPort;
		}

		return this.activePort;
	}

	public getBaseUrl(): string
	{
		return `http://127.0.0.1:${this.getPort()}`;
	}

	public async ensureStarted(partial?: { startupTimeoutMs?: number }): Promise<number>
	{
		if (this.startInFlight !== null)
		{
			return await this.startInFlight;
		}

		var startPromise = this.ensureStartedInternal(partial);
		this.startInFlight = startPromise;

		try
		{
			return await startPromise;
		}
		finally
		{
			if (this.startInFlight === startPromise)
			{
				this.startInFlight = null;
			}
		}
	}

	private async ensureStartedInternal(partial?: { startupTimeoutMs?: number }): Promise<number>
	{
		return await this.withStartupLock(async () =>
		{
			this.ensureClaudeCliScriptConfigured();

			if (this.activePort !== null)
			{
				var activeWorker = await this.getClaudeMemWorkerInfo(this.activePort, 1000, 2);
				if (this.isExpectedWorkerInfo(activeWorker))
				{
					this.writeWorkerState(activeWorker!);
					return this.activePort;
				}

				this.activePort = null;
			}

			var timeoutMs = partial?.startupTimeoutMs ?? this.options.startupTimeoutMs;
			var preferredPort = this.options.preferredPort;
			var portsToTry = this.options.enablePortFallback
				? this.buildPortCandidates(preferredPort)
				: [preferredPort];
			var knownState = this.readWorkerState();
			var reuseOrder = this.buildReuseOrder(portsToTry, knownState);

			for (var i = 0; i < reuseOrder.length; i++)
			{
				var existingPort = reuseOrder[i];
				var existingWorker = await this.getClaudeMemWorkerInfo(existingPort, 1200, 2);
				if (!this.isExpectedWorkerInfo(existingWorker))
				{
					continue;
				}

				this.activePort = existingPort;
				this.writeWorkerState(existingWorker!);
				await this.cleanupManagedButUnhealthyWorkers(portsToTry, knownState, existingPort);
				await this.cleanupDuplicateWorkers(existingPort, portsToTry);
				return existingPort;
			}

			await this.cleanupManagedButUnhealthyWorkers(portsToTry, knownState, null);

			for (var j = 0; j < portsToTry.length; j++)
			{
				var port = portsToTry[j];
				if (await this.isForeignProcessUsingPort(port))
				{
					continue;
				}

				var started = await this.tryStartWorker(port);
				if (!started)
				{
					continue;
				}

				if (!(await this.waitForReadiness(port, timeoutMs)))
				{
					await this.cleanupManagedPortIfNeeded(port, knownState);
					continue;
				}

				var startedWorker = await this.getClaudeMemWorkerInfo(port, 1200, 2);
				if (this.isExpectedWorkerInfo(startedWorker))
				{
					this.activePort = port;
					this.writeWorkerState(startedWorker!);
					await this.cleanupManagedButUnhealthyWorkers(portsToTry, knownState, port);
					await this.cleanupDuplicateWorkers(port, portsToTry);
					return port;
				}

				var listener = await this.getListeningProcessInfo(port);
				this.activePort = port;
				this.writeWorkerState({
					pid: listener?.pid ?? null,
					port,
					workerPath: this.options.scriptPath,
					version: null,
					managed: true,
					status: "ok",
				});
				await this.cleanupManagedButUnhealthyWorkers(portsToTry, knownState, port);
				await this.cleanupDuplicateWorkers(port, portsToTry);
				return port;
			}

			this.activePort = null;
			throw new Error(`ClaudeMem worker failed to start on port ${preferredPort}`);
		});
	}

	public async waitUntilReady(timeoutMs: number): Promise<boolean>
	{
		return await this.waitForReadiness(this.getPort(), timeoutMs);
	}

	public async isReady(timeoutMs: number = 50): Promise<boolean>
	{
		return await this.waitForReadiness(this.getPort(), timeoutMs);
	}

	private buildPortCandidates(preferredPort: number): number[]
	{
		var candidates: number[] = [];
		for (var i = 0; i < 20; i++)
		{
			candidates.push(preferredPort + i);
		}

		return candidates;
	}

	private buildWorkerStateFilePath(scriptPath: string): string
	{
		var homeDir = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
		var stateDir = join(homeDir, ".claude-mem", "opencode-worker-state");
		mkdirSync(stateDir, { recursive: true });
		var hash = createHash("sha1").update(scriptPath).digest("hex").slice(0, 16);
		return join(stateDir, `${hash}.json`);
	}

	private async withStartupLock<T>(action: () => Promise<T>): Promise<T>
	{
		var lockAcquired = false;
		var lockStart = Date.now();
		while (!lockAcquired)
		{
			try
			{
				mkdirSync(this.startupLockPath);
				lockAcquired = true;
				break;
			}
			catch
			{
				try
				{
					var ageMs = Date.now() - statSync(this.startupLockPath).mtimeMs;
					if (ageMs > 30000)
					{
						rmSync(this.startupLockPath, { recursive: true, force: true });
						continue;
					}
				}
				catch
				{
				}

				if (Date.now() - lockStart > 35000)
				{
					throw new Error("Timed out acquiring claude-mem worker startup lock");
				}

				await new Promise(resolve => setTimeout(resolve, 150));
			}
		}

		try
		{
			return await action();
		}
		finally
		{
			if (lockAcquired)
			{
				rmSync(this.startupLockPath, { recursive: true, force: true });
			}
		}
	}

	private readWorkerState(): WorkerState | null
	{
		if (!existsSync(this.stateFilePath))
		{
			return null;
		}

		try
		{
			var raw = readFileSync(this.stateFilePath, "utf8");
			var parsed = JSON.parse(raw) as WorkerState;
			if (!parsed || !Number.isInteger(parsed.port) || typeof parsed.workerPath !== "string")
			{
				return null;
			}

			return parsed;
		}
		catch
		{
			return null;
		}
	}

	private writeWorkerState(info: WorkerHealthInfo | WorkerState): void
	{
		var state: WorkerState = {
			pid: info.pid ?? null,
			port: info.port,
			workerPath: info.workerPath ?? this.options.scriptPath,
			version: info.version ?? null,
			managed: info.managed,
			updatedAt: Date.now(),
		};

		writeFileSync(this.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	}

	private clearWorkerState(): void
	{
		try
		{
			if (existsSync(this.stateFilePath))
			{
				unlinkSync(this.stateFilePath);
			}
		}
		catch
		{
		}
	}

	private buildReuseOrder(portsToTry: number[], knownState: WorkerState | null): number[]
	{
		var ordered = knownState !== null
			? [knownState.port, ...portsToTry]
			: [...portsToTry];

		var unique = new Set<number>();
		var result: number[] = [];
		for (var i = 0; i < ordered.length; i++)
		{
			var port = ordered[i];
			if (!Number.isInteger(port) || unique.has(port))
			{
				continue;
			}

			unique.add(port);
			result.push(port);
		}

		return result;
	}

	private async tryStartWorker(port: number): Promise<boolean>
	{
		try
		{
			var now = Date.now();
			if (now - this.lastStartAttemptEpochMs < 2000)
			{
				return false;
			}

			if (!this.options.enablePortFallback && this.lastFailedStartEpochMs > 0 && now - this.lastFailedStartEpochMs < this.startFailureCooldownMs)
			{
				return false;
			}

			this.lastStartAttemptEpochMs = now;
			var bunExecutable = this.resolveBunExecutablePath();
			if (bunExecutable === null)
			{
				console.error("[ClaudeMem] ERROR: bun executable could not be resolved.");
				this.lastFailedStartEpochMs = Date.now();
				return false;
			}

			this.ensureClaudeCliScriptConfigured();

			// 检查 bun 可用性（仅首次校验，避免对话期间反复触发子进程）
			if (!this.hasValidatedBunRuntime)
			{
				var bunCheck = spawnSync(bunExecutable, ["--version"], { encoding: "utf8", windowsHide: true });
				if (bunCheck.error || bunCheck.status !== 0)
				{
					console.error("[ClaudeMem] ERROR: bun is required but not found in PATH. Install: https://bun.sh");
					this.lastFailedStartEpochMs = Date.now();
					return false;
				}

				this.hasValidatedBunRuntime = true;
			}

			var env = {
				...process.env,
				CLAUDE_MEM_WORKER_PORT: String(port),
				CLAUDE_MEM_WORKER_HOST: "127.0.0.1",
				CLAUDE_MEM_MANAGED: "true",
			};
			this.prependRuntimePath(env, dirname(bunExecutable));

			var workerArgs = [this.options.scriptPath, "opencode-daemon"];
			if (process.platform === "win32" && existsSync(this.workerPreloadPath))
			{
				workerArgs = ["--preload", this.workerPreloadPath, this.options.scriptPath, "opencode-daemon"];
			}

		var child = spawn(
			bunExecutable,
			workerArgs,
				{
					detached: false,
					stdio: "ignore",
					env,
					windowsHide: true,
					shell: false,
				}
			);

			child.unref();
			this.lastFailedStartEpochMs = 0;
			return true;
		}
		catch
		{
			this.lastFailedStartEpochMs = Date.now();
			return false;
		}
	}

	private resolveBunExecutablePath(): string | null
	{
		if (this.bunExecutablePath !== null)
		{
			return this.bunExecutablePath;
		}

		var candidates: string[] = [];
		if (process.platform === "win32")
		{
			try
			{
				var whereResult = spawnSync("where", ["bun"], { encoding: "utf8", windowsHide: true });
				if (!whereResult.error && whereResult.status === 0)
				{
					var discovered = whereResult.stdout
						.split(/\r?\n/)
						.map(line => line.trim())
						.filter(line => line.length > 0);
					candidates.push(...discovered.filter(line => line.toLowerCase().endsWith(".exe")));
					candidates.push(...discovered.filter(line => !line.toLowerCase().endsWith(".exe")));
				}
			}
			catch
			{
			}

			if (process.env.USERPROFILE)
			{
				candidates.push(`${process.env.USERPROFILE}\\.bun\\bin\\bun.exe`);
			}
			if (process.env.LOCALAPPDATA)
			{
				candidates.push(`${process.env.LOCALAPPDATA}\\bun\\bun.exe`);
			}
		}
		else
		{
			candidates.push("bun");
		}

		for (var candidate of candidates)
		{
			if (!candidate)
			{
				continue;
			}

			if (candidate === "bun" || existsSync(candidate))
			{
				this.bunExecutablePath = candidate;
				return candidate;
			}
		}

		return null;
	}

	private normalizePathForComparison(value: string | null | undefined): string
	{
		return (value ?? "").replace(/\\/g, "/").toLowerCase();
	}

	private isExpectedWorkerInfo(info: WorkerHealthInfo | null): boolean
	{
		if (!info)
		{
			return false;
		}

		if (info.status !== "ok" || !info.managed)
		{
			return false;
		}

		return this.normalizePathForComparison(info.workerPath) === this.normalizePathForComparison(this.options.scriptPath);
	}

	private async getClaudeMemWorkerInfo(port: number, timeoutMs: number, attempts: number): Promise<WorkerHealthInfo | null>
	{
		for (var attempt = 0; attempt < attempts; attempt++)
		{
			try
			{
				var health = await this.fetchJsonWithTimeout(`http://127.0.0.1:${port}/api/health`, timeoutMs);
				if (!health.ok)
				{
					continue;
				}

				var body = health.body as Record<string, unknown>;
				var version = typeof body.version === "string" ? body.version : null;
				if (version === null)
				{
					var versionRes = await this.fetchJsonWithTimeout(`http://127.0.0.1:${port}/api/version`, timeoutMs);
					if (versionRes.ok)
					{
						var versionBody = versionRes.body as Record<string, unknown>;
						version = typeof versionBody.version === "string" ? versionBody.version : null;
					}
				}

				return {
					pid: typeof body.pid === "number" ? body.pid : null,
					port,
					workerPath: typeof body.workerPath === "string" ? body.workerPath : null,
					version,
					managed: body.managed === true,
					status: typeof body.status === "string" ? body.status : null,
				};
			}
			catch
			{
			}

			if (attempt < attempts - 1)
			{
				await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
			}
		}

		return null;
	}

	private prependRuntimePath(env: NodeJS.ProcessEnv, runtimeDir: string): void
	{
		if (!runtimeDir)
		{
			return;
		}

		var pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
		var existing = env[pathKey] ?? env.PATH ?? "";
		var parts = existing.split(delimiter).filter(part => part.length > 0);
		var normalizedRuntimeDir = runtimeDir.toLowerCase();
		var filtered = parts.filter(part => part.toLowerCase() !== normalizedRuntimeDir);
		env[pathKey] = [runtimeDir, ...filtered].join(delimiter);
		if (pathKey !== "PATH")
		{
			env.PATH = env[pathKey];
		}
	}

	private ensureClaudeCliScriptConfigured(): void
	{
		if (process.platform !== "win32")
		{
			return;
		}

		var cliScriptPath = this.resolveClaudeCliScriptPath();
		if (cliScriptPath === null)
		{
			return;
		}

		var settingsPath = join(process.env.USERPROFILE ?? "", ".claude-mem", "settings.json");
		if (!settingsPath || !existsSync(settingsPath))
		{
			return;
		}

		try
		{
			var raw = readFileSync(settingsPath, "utf8");
			var settings = JSON.parse(raw) as Record<string, string>;
			var current = (settings.CLAUDE_CODE_PATH ?? "").trim();
			var shouldUpdate = current.length === 0
				|| current.toLowerCase() === "claude.cmd"
				|| current.toLowerCase() === "claude"
				|| current.toLowerCase().endsWith("\\claude.cmd")
				|| current.toLowerCase().endsWith("\\claude");

			if (!shouldUpdate)
			{
				return;
			}

			settings.CLAUDE_CODE_PATH = cliScriptPath;
			writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		}
		catch
		{
		}
	}

	private resolveClaudeCliScriptPath(): string | null
	{
		try
		{
			var whereResult = spawnSync("where", ["claude.cmd"], { encoding: "utf8", windowsHide: true });
			if (whereResult.error || whereResult.status !== 0)
			{
				return null;
			}

			var commandPath = whereResult.stdout
				.split(/\r?\n/)
				.map(line => line.trim())
				.find(line => line.length > 0);
			if (!commandPath)
			{
				return null;
			}

			var cliScriptPath = join(dirname(commandPath), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
			return existsSync(cliScriptPath) ? cliScriptPath : null;
		}
		catch
		{
			return null;
		}
	}

	private async isClaudeMemWorker(port: number): Promise<boolean>
	{
		return this.isExpectedWorkerInfo(await this.getClaudeMemWorkerInfo(port, 800, 2));
	}

	private async isPortOccupiedByOtherService(port: number): Promise<boolean>
	{
		try
		{
			var res = await this.fetchRawWithTimeout(
				`http://127.0.0.1:${port}/`,
				400
			);

			if (!res.ok)
			{
				return false;
			}

			return !(await this.isClaudeMemWorker(port));
		}
		catch
		{
			return false;
		}
	}

	private isPortListening(port: number): boolean
	{
		try
		{
			var { execSync } = require("child_process");
			if (process.platform === "win32")
			{
				var output = execSync(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, { encoding: "utf8", windowsHide: true });
				return output.trim().length > 0;
			}

			var unixOutput = execSync(`lsof -i:${port} -sTCP:LISTEN`, { encoding: "utf8", windowsHide: true });
			return unixOutput.trim().length > 0;
		}
		catch
		{
			return false;
		}
	}

	private async killProcessOnPort(port: number): Promise<boolean>
	{
		var info = await this.getListeningProcessInfo(port);
		if (!info)
		{
			return false;
		}

		return await this.killProcessByPid(info.pid);
	}

	private async getListeningProcessInfo(port: number): Promise<ProcessInfo | null>
	{
		try
		{
			if (process.platform === "win32")
			{
				try
				{
					var psCommand = `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $conn) { exit 1 }; Get-CimInstance Win32_Process -Filter \"ProcessId = $($conn.OwningProcess)\" | Select-Object ProcessId, CommandLine, CreationDate | ConvertTo-Json -Compress`;
					var psResult = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { encoding: "utf8", windowsHide: true });
					if (!psResult.error && psResult.status === 0 && psResult.stdout.trim().length > 0)
					{
						var parsed = JSON.parse(psResult.stdout.trim()) as { ProcessId?: number; CommandLine?: string; CreationDate?: string };
						if (typeof parsed.ProcessId === "number" && parsed.ProcessId > 0)
						{
							return {
								pid: parsed.ProcessId,
								commandLine: typeof parsed.CommandLine === "string" ? parsed.CommandLine : null,
								createdAt: typeof parsed.CreationDate === "string" ? parsed.CreationDate : null,
							};
						}
					}
				}
				catch
				{
				}

				try
				{
					var output = spawnSync("cmd", ["/c", `netstat -ano | findstr ":${port} " | findstr "LISTENING"`], { encoding: "utf8", windowsHide: true });
					if (!output.error && output.status === 0)
					{
						var lines = output.stdout.trim().split(/\r?\n/);
						for (var i = 0; i < lines.length; i++)
						{
							var match = lines[i].trim().match(/(\d+)\s*$/);
							if (!match)
							{
								continue;
							}

							var pid = parseInt(match[1], 10);
							if (!Number.isInteger(pid) || pid <= 0)
							{
								continue;
							}

							return {
								pid,
								commandLine: await this.getProcessCommandLine(pid),
								createdAt: null,
							};
						}
					}
				}
				catch
				{
				}
			}
			else
			{
				try
				{
					var unixOutput = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8", windowsHide: true });
					var pidValue = unixOutput.stdout.trim();
					if (pidValue)
					{
						var unixPid = parseInt(pidValue, 10);
						if (Number.isInteger(unixPid) && unixPid > 0)
						{
							return {
								pid: unixPid,
								commandLine: await this.getProcessCommandLine(unixPid),
								createdAt: null,
							};
						}
					}
				}
				catch
				{
				}
			}
		}
		catch
		{
		}

		return null;
	}

	private async getProcessCommandLine(pid: number): Promise<string | null>
	{
		try
		{
			if (process.platform === "win32")
			{
				var psCommand = `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine | Out-String`;
				var result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { encoding: "utf8", windowsHide: true });
				if (!result.error && result.status === 0)
				{
					var commandLine = result.stdout.trim();
					return commandLine.length > 0 ? commandLine : null;
				}
			}
			else
			{
				var unixResult = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", windowsHide: true });
				if (!unixResult.error && unixResult.status === 0)
				{
					var unixCommandLine = unixResult.stdout.trim();
					return unixCommandLine.length > 0 ? unixCommandLine : null;
				}
			}
		}
		catch
		{
		}

		return null;
	}

	private isManagedWorkerProcessInfo(info: ProcessInfo | null, knownState: WorkerState | null): boolean
	{
		if (!info)
		{
			return false;
		}

		if (knownState !== null && knownState.pid === info.pid)
		{
			return true;
		}

		var commandLine = this.normalizePathForComparison(info.commandLine);
		return commandLine.includes(this.normalizePathForComparison(this.options.scriptPath))
			&& commandLine.includes("opencode-daemon");
	}

	private async killProcessByPid(pid: number): Promise<boolean>
	{
		try
		{
			if (process.platform === "win32")
			{
				spawnSync("taskkill", ["/F", "/PID", String(pid), "/T"], { windowsHide: true, stdio: "ignore" });
			}
			else
			{
				spawnSync("kill", ["-9", String(pid)], { windowsHide: true, stdio: "ignore" });
			}

			return true;
		}
		catch
		{
			return false;
		}
	}

	private async isForeignProcessUsingPort(port: number): Promise<boolean>
	{
		var worker = await this.getClaudeMemWorkerInfo(port, 800, 1);
		if (this.isExpectedWorkerInfo(worker))
		{
			return false;
		}

		var listener = await this.getListeningProcessInfo(port);
		if (!listener)
		{
			return false;
		}

		var knownState = this.readWorkerState();
		return !this.isManagedWorkerProcessInfo(listener, knownState);
	}

	private async cleanupManagedPortIfNeeded(port: number, knownState: WorkerState | null): Promise<void>
	{
		var listener = await this.getListeningProcessInfo(port);
		if (!this.isManagedWorkerProcessInfo(listener, knownState))
		{
			return;
		}

		if (listener === null)
		{
			return;
		}

		console.log(`[ClaudeMem] Cleaning up failed managed worker on port ${port} (PID ${listener.pid})`);
		await this.killProcessByPid(listener.pid);
		if (knownState !== null && knownState.pid === listener.pid)
		{
			this.clearWorkerState();
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}

	private async cleanupManagedButUnhealthyWorkers(ports: number[], knownState: WorkerState | null, activePort: number | null): Promise<void>
	{
		for (var i = 0; i < ports.length; i++)
		{
			var port = ports[i];
			if (activePort !== null && port === activePort)
			{
				continue;
			}

			var worker = await this.getClaudeMemWorkerInfo(port, 800, 1);
			if (this.isExpectedWorkerInfo(worker))
			{
				continue;
			}

			var listener = await this.getListeningProcessInfo(port);
			if (!this.isManagedWorkerProcessInfo(listener, knownState))
			{
				continue;
			}

			if (listener === null)
			{
				continue;
			}

			console.log(`[ClaudeMem] Reaping stale managed worker on port ${port} (PID ${listener.pid})`);
			await this.killProcessByPid(listener.pid);
			await new Promise(resolve => setTimeout(resolve, 500));
		}

		var refreshedState = this.readWorkerState();
		if (refreshedState !== null)
		{
			var refreshedWorker = await this.getClaudeMemWorkerInfo(refreshedState.port, 800, 1);
			if (!this.isExpectedWorkerInfo(refreshedWorker))
			{
				this.clearWorkerState();
			}
		}
	}

	private async cleanupDuplicateWorkers(activePort: number, ports: number[]): Promise<void>
	{
		for (var i = 0; i < ports.length; i++)
		{
			var port = ports[i];
			if (port === activePort)
			{
				continue;
			}

			var worker = await this.getClaudeMemWorkerInfo(port, 800, 1);
			if (!this.isExpectedWorkerInfo(worker))
			{
				continue;
			}

			if (worker === null || worker.pid === null)
			{
				continue;
			}

			console.log(`[ClaudeMem] Reaping duplicate managed worker on port ${port} (PID ${worker.pid})`);
			await this.killProcessByPid(worker.pid);
			await new Promise(resolve => setTimeout(resolve, 500));
		}
	}

	private async waitForReadiness(port: number, timeoutMs: number): Promise<boolean>
	{
		var startTime = Date.now();
		while (Date.now() - startTime < timeoutMs)
		{
			var elapsedMs = Date.now() - startTime;
			var remainingMs = timeoutMs - elapsedMs;
			if (remainingMs <= 0)
			{
				break;
			}

			try
			{
				var res = await this.fetchJsonWithTimeout(
					`http://127.0.0.1:${port}/api/readiness`,
					Math.min(800, Math.max(50, remainingMs))
				);

				if (res.ok)
				{
					return true;
				}
			}
			catch
			{
			}

			await new Promise(resolve => setTimeout(resolve, Math.min(250, remainingMs)));
		}

		return false;
	}

	private async fetchRawWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number }>
	{
		var controller = new AbortController();
		var timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try
		{
			var res = await fetch(url, { signal: controller.signal });
			return { ok: res.ok, status: res.status };
		}
		finally
		{
			clearTimeout(timeoutId);
		}
	}

	private async fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: unknown }>
	{
		var controller = new AbortController();
		var timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try
		{
			var res = await fetch(url, { signal: controller.signal });
			if (!res.ok)
			{
				return { ok: false, status: res.status, body: null };
			}

			var body = await res.json();
			return { ok: true, status: res.status, body };
		}
		finally
		{
			clearTimeout(timeoutId);
		}
	}
}
