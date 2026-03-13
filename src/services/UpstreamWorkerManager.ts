import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";

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
		this.ensureClaudeCliScriptConfigured();

		if (this.activePort !== null)
		{
			if (await this.isClaudeMemWorker(this.activePort))
			{
				return this.activePort;
			}

			this.activePort = null;
		}

		var timeoutMs = partial?.startupTimeoutMs ?? this.options.startupTimeoutMs;
		var preferredPort = this.options.preferredPort;

		// Always try preferred port first, kill any occupying process if needed
		if (await this.isPortOccupiedByOtherService(preferredPort))
		{
			console.log(`[ClaudeMem] Port ${preferredPort} is occupied. Attempting to free it...`);
			var killed = await this.killProcessOnPort(preferredPort);
			if (killed)
			{
				// Wait for port to be released
				await new Promise(resolve => setTimeout(resolve, 1000));
				console.log(`[ClaudeMem] Port ${preferredPort} is now free.`);
			}
		}

		if (await this.isClaudeMemWorker(preferredPort))
		{
			this.activePort = preferredPort;
			return preferredPort;
		}

		if (this.isPortListening(preferredPort))
		{
			console.log(`[ClaudeMem] Port ${preferredPort} is occupied by an unresponsive process. Attempting cleanup...`);
			await this.killProcessOnPort(preferredPort);
			await new Promise(resolve => setTimeout(resolve, 1200));
		}

		var portsToTry = this.options.enablePortFallback
			? this.buildPortCandidates(preferredPort)
			: [preferredPort];

		// 如果禁用了 fallback，重试多次并尝试杀掉占用进程
		var maxRetries = this.options.enablePortFallback ? 1 : 5;
		
		for (var retry = 0; retry < maxRetries; retry++)
		{
			if (retry > 0)
			{
				console.log(`[ClaudeMem] Retry ${retry}/${maxRetries - 1}: Checking port ${preferredPort}...`);
				await new Promise(resolve => setTimeout(resolve, 2000));
				
				// 每次重试都尝试杀掉占用进程
				if (await this.isPortOccupiedByOtherService(preferredPort))
				{
					console.log(`[ClaudeMem] Attempting to kill process on port ${preferredPort}...`);
					await this.killProcessOnPort(preferredPort);
					await new Promise(resolve => setTimeout(resolve, 1500));
				}
			}

			for (var i = 0; i < portsToTry.length; i++)
			{
				var port = portsToTry[i];

				if (await this.isClaudeMemWorker(port))
				{
					this.activePort = port;
					return port;
				}

				if (await this.isPortOccupiedByOtherService(port))
				{
					if (this.isPortListening(port))
					{
						await this.killProcessOnPort(port);
						await new Promise(resolve => setTimeout(resolve, 1000));
					}
					continue;
				}

				var started = await this.tryStartWorker(port);
				if (!started)
				{
					continue;
				}

				if (await this.waitForReadiness(port, timeoutMs))
				{
					this.activePort = port;
					return port;
				}
			}
		}

		this.activePort = null;
		throw new Error(`ClaudeMem worker failed to start on port ${preferredPort}`);
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
		try
		{
			var readiness = await this.fetchJsonWithTimeout(
				`http://127.0.0.1:${port}/api/health`,
				800
			);

			if (!readiness.ok)
			{
				return false;
			}

			var body = readiness.body as any;
			if (!body || body.status !== "ok")
			{
				return false;
			}

			var version = await this.fetchJsonWithTimeout(
				`http://127.0.0.1:${port}/api/version`,
				800
			);

			return version.ok && typeof (version.body as any)?.version === "string";
		}
		catch
		{
			return false;
		}
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
			return this.isPortListening(port);
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
		try
		{
			var platform = process.platform;
			var { execSync } = require('child_process');
			
			if (platform === 'win32')
			{
				// Windows Method 1: netstat + taskkill
				try
				{
					var output = execSync(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, { encoding: 'utf8', windowsHide: true });
					var lines = output.trim().split('\n');
					for (var line of lines)
					{
						var match = line.trim().match(/(\d+)\s*$/);
						if (match)
						{
							var pid = match[1];
							console.log(`[ClaudeMem] Killing process ${pid} on port ${port} (taskkill)`);
							execSync(`taskkill /F /PID ${pid} /T`, { windowsHide: true });
							return true;
						}
					}
				}
				catch
				{
					// Try PowerShell method
				}

				// Windows Method 2: PowerShell Get-NetTCPConnection + Stop-Process
				try
				{
					var psCmd = `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`;
					console.log(`[ClaudeMem] Attempting to kill process on port ${port} (PowerShell)`);
					execSync(psCmd, { stdio: 'ignore', windowsHide: true });
					return true;
				}
				catch
				{
					// Try WMIC method
				}

				// Windows Method 3: WMIC
				try
				{
					var wmicOutput = execSync(`wmic process where "commandline like '%claude-mem%'" get processid`, { encoding: 'utf8', windowsHide: true });
					var pids = wmicOutput.split('\n').slice(1).map((s: string) => s.trim()).filter((s: string) => s && !isNaN(parseInt(s)));
					for (var pid of pids)
					{
						console.log(`[ClaudeMem] Killing claude-mem process ${pid} (WMIC)`);
						execSync(`wmic process ${pid} delete`, { stdio: 'ignore', windowsHide: true });
					}
					if (pids.length > 0) return true;
				}
				catch
				{
					// All methods failed
				}
			}
			else
			{
				// Unix/Mac: use lsof
				try
				{
					var output = execSync(`lsof -ti:${port}`, { encoding: 'utf8', windowsHide: true });
					var pid = output.trim();
					if (pid)
					{
						console.log(`[ClaudeMem] Killing process ${pid} on port ${port}`);
						execSync(`kill -9 ${pid}`, { windowsHide: true });
						return true;
					}
				}
				catch
				{
					// Process not found or kill failed
				}
			}
		}
		catch (e)
		{
			console.error(`[ClaudeMem] Failed to kill process on port ${port}:`, e);
		}
		return false;
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
