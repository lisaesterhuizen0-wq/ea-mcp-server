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

// 3. Connect over stdio (how Claude launches and talks to the server).
const transport = new StdioServerTransport();
await server.connect(transport);

// Logs MUST go to stderr — stdout is reserved for the MCP protocol itself.
console.error("ea-mcp-server running (stdio). Tools: time_in");
