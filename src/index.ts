import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. Create the server. This name + version is how Claude identifies it.
const server = new McpServer({
  name: "ea-mcp-server",
  version: "0.1.0",
});

// 2. Register a tool. Claude reads the description to decide when to call it.
server.registerTool(
  "time_in",
  {
    title: "Current time in a timezone",
    description:
      "Get the current local time in a given IANA timezone, e.g. 'Europe/Berlin' or 'Africa/Johannesburg'. Use when scheduling across timezones.",
    inputSchema: {
      timezone: z
        .string()
        .describe("An IANA timezone name, e.g. 'Europe/Berlin'"),
    },
  },
  async ({ timezone }) => {
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(now);

      return {
        content: [{ type: "text", text: `It is ${formatted} in ${timezone}.` }],
      };
    } catch {
      // Invalid timezone: report a clean error instead of crashing.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `'${timezone}' is not a valid IANA timezone. Try one like 'Europe/Berlin' or 'Africa/Johannesburg'.`,
          },
        ],
      };
    }
  }
);

// Helper: the local hour (0-23) in a timezone for a given instant.
function localHour(instant: Date, timezone: string): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return parseInt(hh, 10);
}

// A second tool: find the working-hours overlap across timezones.
server.registerTool(
  "working_hours_overlap",
  {
    title: "Working-hours overlap across timezones",
    description:
      "Given two or more IANA timezones, find the hours today when everyone's working day overlaps. Use when scheduling a meeting across regions.",
    inputSchema: {
      timezones: z
        .array(z.string())
        .min(1)
        .describe("IANA timezones, e.g. ['Europe/Berlin', 'America/New_York']"),
      workdayStart: z
        .number()
        .min(0)
        .max(23)
        .optional()
        .describe("Local start hour, 0-23. Default 9."),
      workdayEnd: z
        .number()
        .min(1)
        .max(24)
        .optional()
        .describe("Local end hour, 1-24. Default 17."),
    },
  },
  async ({ timezones, workdayStart = 9, workdayEnd = 17 }) => {
    // Validate every timezone up front, fail cleanly on the first bad one.
    for (const tz of timezones) {
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      } catch {
        return {
          isError: true,
          content: [
            { type: "text", text: `'${tz}' is not a valid IANA timezone.` },
          ],
        };
      }
    }

    // Walk each UTC hour of today; keep the ones inside everyone's workday.
    const today = new Date();
    const overlaps: string[] = [];
    for (let utcHour = 0; utcHour < 24; utcHour++) {
      const instant = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), utcHour)
      );
      const worksForEveryone = timezones.every((tz) => {
        const h = localHour(instant, tz);
        return h >= workdayStart && h < workdayEnd;
      });
      if (worksForEveryone) {
        const locals = timezones
          .map((tz) => `${tz.split("/").pop()} ${String(localHour(instant, tz)).padStart(2, "0")}:00`)
          .join(", ");
        overlaps.push(`${String(utcHour).padStart(2, "0")}:00 UTC  (${locals})`);
      }
    }

    const header = `Overlapping working hours (${workdayStart}:00-${workdayEnd}:00 local) for ${timezones.join(", ")}:`;
    const body = overlaps.length
      ? overlaps.join("\n")
      : "No overlapping working hours today. Someone will need to flex.";

    return { content: [{ type: "text", text: `${header}\n${body}` }] };
  }
);

// 3. Connect over stdio (how Claude launches and talks to the server).
const transport = new StdioServerTransport();
await server.connect(transport);

// Logs MUST go to stderr — stdout is reserved for the MCP protocol itself.
console.error("ea-mcp-server running (stdio). Tools: time_in, working_hours_overlap");
