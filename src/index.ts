import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import path from "path";
import { fileURLToPath } from "url";
import { UpstreamWorkerManager } from "./services/UpstreamWorkerManager";
import { searchWithFTSFallback } from "./utils/fts-fallback";
import type { Event, Part, TextPart } from "@opencode-ai/sdk";

interface PluginState
{
	worker: UpstreamWorkerManager | null;
	excludedTools: Set<string>;
	injectedSessionIds: Set<string>;
	toolArgsByCallId: Map<string, any>;
	messageRoleById: Map<string, "user" | "assistant">;
	lastAssistantTextBySessionId: Map<string, string>;
}

const state: PluginState = {
	worker: null,
	excludedTools: new Set([
		"ListMcpResourcesTool",
		"SlashCommand",
		"Skill",
		"TodoWrite",
		"AskUserQuestion",
		"search",
		"timeline",
		"get_observations",
		"save_memory",
		"__IMPORTANT",
	]),
	injectedSessionIds: new Set(),
	toolArgsByCallId: new Map(),
	messageRoleById: new Map(),
	lastAssistantTextBySessionId: new Map(),
};

function getPluginRoot(): string
{
	var srcDir = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(srcDir, "..");
}

function getProjectName(cwd: string): string
{
	var normalized = cwd.replace(/[\\/]+$/, "");
	var name = path.basename(normalized);
	return name && name.trim().length > 0 ? name : "claude-mem";
}

function getSessionId(input: any): string | null
{
	if (!input)
	{
		return null;
	}

	return input.sessionID
		?? input.sessionId
		?? input.session_id
		?? input.id
		?? null;
}

function getToolCallKey(sessionId: string, callId: string): string
{
	return `${sessionId}:${callId}`;
}

function extractTextFromParts(parts: Part[]): string
{
	var texts: string[] = [];

	for (var i = 0; i < parts.length; i++)
	{
		var part = parts[i];
		if (part.type !== "text")
		{
			continue;
		}

		var textPart = part as TextPart;
		if (typeof textPart.text === "string" && textPart.text.trim().length > 0)
		{
			texts.push(textPart.text);
		}
	}

	return texts.join("\n");
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }>
{
	var controller = new AbortController();
	var timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try
	{
		var res = await fetch(url, { signal: controller.signal });
		if (!res.ok)
		{
			return { ok: false, status: res.status, text: "" };
		}

		return { ok: true, status: res.status, text: await res.text() };
	}
	catch
	{
		return { ok: false, status: 0, text: "" };
	}
	finally
	{
		clearTimeout(timeoutId);
	}
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: any }>
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

		return { ok: true, status: res.status, body: await res.json() };
	}
	catch
	{
		return { ok: false, status: 0, body: null };
	}
	finally
	{
		clearTimeout(timeoutId);
	}
}

async function postJsonWithTimeout(url: string, body: any, timeoutMs: number): Promise<{ ok: boolean; status: number; body: any }>
{
	var controller = new AbortController();
	var timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try
	{
		var res = await fetch(
			url,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			}
		);

		if (!res.ok)
		{
			return { ok: false, status: res.status, body: null };
		}

		var contentType = res.headers.get("content-type") || "";
		if (contentType.includes("application/json"))
		{
			return { ok: true, status: res.status, body: await res.json() };
		}

		return { ok: true, status: res.status, body: await res.text() };
	}
	catch
	{
		return { ok: false, status: 0, body: null };
	}
	finally
	{
		clearTimeout(timeoutId);
	}
}

async function initializeWorker(): Promise<void>
{
	if (state.worker !== null)
	{
		return;
	}

	var pluginRoot = getPluginRoot();
	var scriptPath = path.join(
		pluginRoot,
		"vendor",
		"claude-mem",
		"plugin",
		"scripts",
		"worker-service.cjs"
	);

	state.worker = new UpstreamWorkerManager({
		scriptPath,
		preferredPort: 37777,
		enablePortFallback: true,
		startupTimeoutMs: 10000,
	});

	await state.worker.ensureStarted({ startupTimeoutMs: 3000 });
}

export const ClaudeMemPlugin: Plugin = async ({ directory }) =>
{
	await initializeWorker();

	return {
		event: async (input: { event: Event }) =>
		{
			var event = input.event as any;

			if (event.type === "session.created")
			{
				var sessionId = event.properties?.info?.id;
				if (typeof sessionId === "string" && sessionId.length > 0)
				{
					state.injectedSessionIds.delete(sessionId);
					state.lastAssistantTextBySessionId.delete(sessionId);
				}

				await initializeWorker();
				if (state.worker)
				{
					await state.worker.ensureStarted({ startupTimeoutMs: 3000 });
				}

				return;
			}

			if (event.type === "session.deleted")
			{
				var deletedSessionId = event.properties?.info?.id;
				if (typeof deletedSessionId !== "string" || deletedSessionId.length === 0)
				{
					return;
				}

				if (!state.worker)
				{
					return;
				}

				await postJsonWithTimeout(
					`${state.worker.getBaseUrl()}/api/sessions/complete`,
					{
						contentSessionId: deletedSessionId,
					},
					2000
				);

				state.injectedSessionIds.delete(deletedSessionId);
				state.lastAssistantTextBySessionId.delete(deletedSessionId);
				return;
			}

			if (event.type === "message.updated")
			{
				var message = event.properties?.info;
				if (message && typeof message.id === "string" && (message.role === "user" || message.role === "assistant"))
				{
					state.messageRoleById.set(message.id, message.role);
				}

				return;
			}

			if (event.type === "message.part.updated")
			{
				var part = event.properties?.part as Part | undefined;
				if (!part || part.type !== "text")
				{
					return;
				}

				var role = state.messageRoleById.get(part.messageID);
				if (role !== "assistant")
				{
					return;
				}

				var textPart = part as TextPart;
				state.lastAssistantTextBySessionId.set(part.sessionID, textPart.text ?? "");
			}
		},

		"chat.message": async (
			input: {
				sessionID: string;
			},
			output: {
				message: any;
				parts: Part[];
			}
		) =>
		{
			if (!state.worker)
			{
				return;
			}

			var prompt = extractTextFromParts(output.parts);
			var project = getProjectName(directory);

			await postJsonWithTimeout(
				`${state.worker.getBaseUrl()}/api/sessions/init`,
				{
					contentSessionId: input.sessionID,
					project,
					prompt: prompt && prompt.trim().length > 0 ? prompt : "[media prompt]",
				},
				2000
			);
		},

		"experimental.chat.system.transform": async (
			input: {
				sessionID?: string;
			},
			output: {
				system: string[];
			}
		) =>
		{
			var sessionId = input.sessionID;
			if (!sessionId)
			{
				return;
			}

			if (!state.worker)
			{
				return;
			}

			if (state.injectedSessionIds.has(sessionId))
			{
				return;
			}

			await state.worker.ensureStarted({ startupTimeoutMs: 10000 });
			await state.worker.waitUntilReady(10000);

			var project = getProjectName(directory);
			var url = `${state.worker.getBaseUrl()}/api/context/inject?projects=${encodeURIComponent(project)}`;
			var contextRes = await fetchTextWithTimeout(url, 2000);

			if (contextRes.ok && contextRes.text.trim().length > 0)
			{
				output.system.push(`<claude-mem-context>\n${contextRes.text.trim()}\n</claude-mem-context>`);
			}

			state.injectedSessionIds.add(sessionId);
		},

		"experimental.session.compacting": async (input: { sessionID: string }) =>
		{
			if (!state.worker)
			{
				return;
			}

			var lastAssistantText = state.lastAssistantTextBySessionId.get(input.sessionID) ?? "";

			await postJsonWithTimeout(
				`${state.worker.getBaseUrl()}/api/sessions/summarize`,
				{
					contentSessionId: input.sessionID,
					last_assistant_message: lastAssistantText,
				},
				2000
			);
		},

		"tool.execute.before": async (
			input: {
				tool: string;
				sessionID: string;
				callID: string;
			},
			output: {
				args: any;
			}
		) =>
		{
			var toolName = input.tool;
			if (!toolName || state.excludedTools.has(toolName))
			{
				return;
			}

			state.toolArgsByCallId.set(getToolCallKey(input.sessionID, input.callID), output.args);
		},

		"tool.execute.after": async (
			input: {
				tool: string;
				sessionID: string;
				callID: string;
			},
			output: {
				title: string;
				output: string;
				metadata: any;
			}
		) =>
		{
			if (!state.worker)
			{
				return;
			}

			var toolName = input.tool;
			if (!toolName || state.excludedTools.has(toolName))
			{
				return;
			}

			var callKey = getToolCallKey(input.sessionID, input.callID);
			var args = state.toolArgsByCallId.get(callKey) ?? {};
			state.toolArgsByCallId.delete(callKey);

			await postJsonWithTimeout(
				`${state.worker.getBaseUrl()}/api/sessions/observations`,
				{
					contentSessionId: input.sessionID,
					tool_name: toolName,
					tool_input: args,
					tool_response: {
						title: output.title,
						output: output.output,
						metadata: output.metadata,
					},
					cwd: directory,
				},
				2000
			);
		},

		tool: {
			__IMPORTANT: tool({
				description: "3-layer workflow documentation for memory search tools.",
				args: {},
				async execute()
				{
					return [
						"3-LAYER WORKFLOW (ALWAYS FOLLOW):",
						"1. search(query) → Get index with IDs (~50-100 tokens/result)",
						"2. timeline(anchor=ID) → Get context around interesting results",
						"3. get_observations([IDs]) → Fetch full details ONLY for filtered IDs",
						"NEVER fetch full details without filtering first. 10x token savings.",
					].join("\n");
				},
			}),

			search: tool({
				description: "Step 1: Search memory index. Returns compact results with IDs.",
				args: {
					query: tool.schema.string().optional(),
					limit: tool.schema.number().optional(),
					offset: tool.schema.number().optional(),
					type: tool.schema.string().optional(),
					obs_type: tool.schema.string().optional(),
					project: tool.schema.string().optional(),
					dateStart: tool.schema.string().optional(),
					dateEnd: tool.schema.string().optional(),
					orderBy: tool.schema.string().optional(),
				},
			async execute(args)
				{
					await initializeWorker();
					if (!state.worker)
					{
						return "claude-mem worker is not available.";
					}

					await state.worker.ensureStarted({ startupTimeoutMs: 3000 });

					var params = new URLSearchParams();
					if (args.query) params.set("query", args.query);
					if (args.limit !== undefined) params.set("limit", String(args.limit));
					if (args.offset !== undefined) params.set("offset", String(args.offset));
					if (args.type) params.set("type", args.type);
					if (args.obs_type) params.set("obs_type", args.obs_type);
					if (args.project) params.set("project", args.project);
					if (args.dateStart) params.set("dateStart", args.dateStart);
					if (args.dateEnd) params.set("dateEnd", args.dateEnd);
					if (args.orderBy) params.set("orderBy", args.orderBy);

					var res = await fetchJsonWithTimeout(
						`${state.worker.getBaseUrl()}/api/search?${params.toString()}`,
						3000
					);

					var content: string | undefined;

					if (res.ok)
					{
						content = res.body?.content?.[0]?.text;
					}

					// FTS fallback: if upstream returned no results or failed
					var shouldFallback = !res.ok
						|| !content
						|| content.includes("No results found")
						|| content.includes("Vector search failed")
						|| content.includes("semantic search unavailable");

					if (shouldFallback && args.query)
					{
						var fallbackResult = await searchWithFTSFallback(
							args.query,
							args.limit ?? 20,
							args.project,
						);

						if (fallbackResult.length > 0)
						{
							return fallbackResult;
						}
					}

					if (!res.ok)
					{
						return "Search failed.";
					}

					return typeof content === "string" ? content : JSON.stringify(res.body, null, 2);
				},
			}),

			timeline: tool({
				description: "Step 2: Get chronological context around an anchor observation or query.",
				args: {
					anchor: tool.schema.number().optional(),
					query: tool.schema.string().optional(),
					depth_before: tool.schema.number().optional(),
					depth_after: tool.schema.number().optional(),
					project: tool.schema.string().optional(),
				},
				async execute(args)
				{
					await initializeWorker();
					if (!state.worker)
					{
						return "claude-mem worker is not available.";
					}

					await state.worker.ensureStarted({ startupTimeoutMs: 3000 });

					var params = new URLSearchParams();
					if (args.anchor !== undefined) params.set("anchor", String(args.anchor));
					if (args.query) params.set("query", args.query);
					if (args.depth_before !== undefined) params.set("depth_before", String(args.depth_before));
					if (args.depth_after !== undefined) params.set("depth_after", String(args.depth_after));
					if (args.project) params.set("project", args.project);

					var res = await fetchJsonWithTimeout(
						`${state.worker.getBaseUrl()}/api/timeline?${params.toString()}`,
						3000
					);

					if (!res.ok)
					{
						return "Timeline failed.";
					}

					var content = res.body?.content?.[0]?.text;
					return typeof content === "string" ? content : JSON.stringify(res.body, null, 2);
				},
			}),

			get_observations: tool({
				description: "Step 3: Fetch full details for filtered observation IDs.",
				args: {
					ids: tool.schema.array(tool.schema.number()),
					orderBy: tool.schema.string().optional(),
					limit: tool.schema.number().optional(),
					project: tool.schema.string().optional(),
				},
				async execute(args)
				{
					await initializeWorker();
					if (!state.worker)
					{
						return "claude-mem worker is not available.";
					}

					await state.worker.ensureStarted({ startupTimeoutMs: 3000 });

					var res = await postJsonWithTimeout(
						`${state.worker.getBaseUrl()}/api/observations/batch`,
						{
							ids: args.ids,
							orderBy: args.orderBy,
							limit: args.limit,
							project: args.project,
						},
						5000
					);

					if (!res.ok)
					{
						return "get_observations failed.";
					}

					return JSON.stringify(res.body, null, 2);
				},
			}),

			save_memory: tool({
				description: "Manually save an important memory for future reference.",
				args: {
					text: tool.schema.string(),
					title: tool.schema.string().optional(),
					project: tool.schema.string().optional(),
				},
				async execute(args)
				{
					await initializeWorker();
					if (!state.worker)
					{
						return "claude-mem worker is not available.";
					}

					await state.worker.ensureStarted({ startupTimeoutMs: 3000 });

					var res = await postJsonWithTimeout(
						`${state.worker.getBaseUrl()}/api/memory/save`,
						{
							text: args.text,
							title: args.title,
							project: args.project,
						},
						5000
					);

					if (!res.ok)
					{
						return "save_memory failed.";
					}

					var message = res.body?.message;
					return typeof message === "string" ? message : JSON.stringify(res.body, null, 2);
				},
			}),
		},
	};
};

export default ClaudeMemPlugin;
