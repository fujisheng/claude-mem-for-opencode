import { Database } from "bun:sqlite";
import { homedir } from "os";
import path from "path";

const DB_PATH = path.join(homedir(), ".claude-mem", "claude-mem.db");

function formatDate(epoch: number | null | undefined): string
{
	if (!epoch)
	{
		return "";
	}

	var date = new Date(Number(epoch));
	if (Number.isNaN(date.getTime()))
	{
		return "";
	}

	var y = date.getFullYear();
	var m = String(date.getMonth() + 1).padStart(2, "0");
	var d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

interface ObservationRow
{
	id: number;
	title: string | null;
	subtitle: string | null;
	type: string | null;
	project: string | null;
	created_at_epoch: number | null;
}

function buildSearchResponse(query: string, rows: ObservationRow[]): string
{
	if (!rows.length)
	{
		return `No results found matching "${query}"`;
	}

	var lines: string[] = [];
	lines.push(`Found ${rows.length} observation(s) matching "${query}"`);
	lines.push("");
	lines.push("| ID | Date | T | Title | Project |");
	lines.push("|----|------|---|-------|---------|");

	for (var row of rows)
	{
		var title = row.title || row.subtitle || "(untitled)";
		var type = row.type || "-";
		var date = formatDate(row.created_at_epoch);
		var project = row.project || "-";
		lines.push(`| #${row.id} | ${date} | ${type} | ${title} | ${project} |`);
	}

	return lines.join("\n");
}

export async function searchWithFTSFallback(
	query: string,
	limit: number = 20,
	project?: string,
): Promise<string>
{
	try
	{
		var fs = await import("fs");
		if (!fs.existsSync(DB_PATH))
		{
			return "";
		}

		var clampedLimit = Math.min(Math.max(limit, 1), 100);
		var db = new Database(DB_PATH, { readonly: true });

		try
		{
			var filters: string[] = [];
			var values: any[] = [];

			if (project)
			{
				filters.push("o.project = ?");
				values.push(project);
			}

			var whereClause = filters.length ? `AND ${filters.join(" AND ")}` : "";
			var safeQuery = `"${query.replace(/"/g, '""')}"`;
			var rows: ObservationRow[] = [];

			// Phase 1: FTS5 MATCH query with BM25 ranking
			try
			{
				var ftsSql = `
					SELECT o.id, o.title, o.subtitle, o.type, o.project, o.created_at_epoch
					FROM observations_fts fts
					JOIN observations o ON o.id = fts.rowid
					WHERE observations_fts MATCH ? ${whereClause}
					ORDER BY bm25(observations_fts) ASC, o.created_at_epoch DESC
					LIMIT ?
				`;
				rows = db.prepare(ftsSql).all(safeQuery, ...values, clampedLimit) as ObservationRow[];
			}
			catch
			{
				rows = [];
			}

			// Phase 2: LIKE fallback if FTS5 MATCH returns nothing
			if (!rows.length)
			{
				var likeClause = [
					"o.title LIKE ?",
					"o.subtitle LIKE ?",
					"o.narrative LIKE ?",
					"o.text LIKE ?",
					"o.facts LIKE ?",
					"o.concepts LIKE ?",
				].join(" OR ");

				var likeSql = `
					SELECT o.id, o.title, o.subtitle, o.type, o.project, o.created_at_epoch
					FROM observations o
					WHERE (${likeClause}) ${whereClause}
					ORDER BY o.created_at_epoch DESC
					LIMIT ?
				`;

				var likeValue = `%${query}%`;
				var likeValues = Array(6).fill(likeValue);
				rows = db.prepare(likeSql).all(...likeValues, ...values, clampedLimit) as ObservationRow[];
			}

			return buildSearchResponse(query, rows);
		}
		finally
		{
			db.close();
		}
	}
	catch
	{
		return "";
	}
}
