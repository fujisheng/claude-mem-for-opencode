import { spawn, spawnSync } from "child_process";

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
	private lastStartAttemptEpochMs: number;

	public constructor(options: UpstreamWorkerManagerOptions)
	{
		this.options = options;
		this.activePort = null;
		this.lastStartAttemptEpochMs = 0;
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

		this.activePort = preferredPort;
		return preferredPort;
	}

	public async waitUntilReady(timeoutMs: number): Promise<boolean>
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

			this.lastStartAttemptEpochMs = now;

			// 检查 bun 可用性
			var bunCheck = spawnSync("bun", ["--version"], { encoding: "utf8" });
			if (bunCheck.error || bunCheck.status !== 0)
			{
				console.error("[ClaudeMem] ERROR: bun is required but not found in PATH. Install: https://bun.sh");
				return false;
			}

			var env = {
				...process.env,
				CLAUDE_MEM_WORKER_PORT: String(port),
				CLAUDE_MEM_WORKER_HOST: "127.0.0.1",
				CLAUDE_MEM_MANAGED: "true",
			};

		var child = spawn(
			"bun",
			[
				this.options.scriptPath,
			],
				{
					detached: true,
					stdio: "ignore",
					env,
					windowsHide: false,
				}
			);

			child.unref();
			return true;
		}
		catch
		{
			return false;
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
					var output = execSync(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, { encoding: 'utf8' });
					var lines = output.trim().split('\n');
					for (var line of lines)
					{
						var match = line.trim().match(/(\d+)\s*$/);
						if (match)
						{
							var pid = match[1];
							console.log(`[ClaudeMem] Killing process ${pid} on port ${port} (taskkill)`);
							execSync(`taskkill /F /PID ${pid} /T`);
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
					execSync(psCmd, { stdio: 'ignore' });
					return true;
				}
				catch
				{
					// Try WMIC method
				}

				// Windows Method 3: WMIC
				try
				{
					var wmicOutput = execSync(`wmic process where "commandline like '%claude-mem%'" get processid`, { encoding: 'utf8' });
					var pids = wmicOutput.split('\n').slice(1).map((s: string) => s.trim()).filter((s: string) => s && !isNaN(parseInt(s)));
					for (var pid of pids)
					{
						console.log(`[ClaudeMem] Killing claude-mem process ${pid} (WMIC)`);
						execSync(`wmic process ${pid} delete`, { stdio: 'ignore' });
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
					var output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' });
					var pid = output.trim();
					if (pid)
					{
						console.log(`[ClaudeMem] Killing process ${pid} on port ${port}`);
						execSync(`kill -9 ${pid}`);
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
			try
			{
				var res = await this.fetchJsonWithTimeout(
					`http://127.0.0.1:${port}/api/readiness`,
					800
				);

				if (res.ok)
				{
					return true;
				}
			}
			catch
			{
			}

			await new Promise(resolve => setTimeout(resolve, 250));
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
