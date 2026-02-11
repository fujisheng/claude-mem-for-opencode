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

		if (await this.isClaudeMemWorker(preferredPort))
		{
			this.activePort = preferredPort;
			return preferredPort;
		}

		var portsToTry = this.options.enablePortFallback
			? this.buildPortCandidates(preferredPort)
			: [preferredPort];

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
					"start",
				],
				{
					detached: true,
					stdio: "ignore",
					env,
					windowsHide: true,
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
