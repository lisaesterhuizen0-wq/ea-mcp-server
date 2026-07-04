import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
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

// Helper: turn a wall-clock time in a timezone into a real UTC instant.
// JS has no direct API for this, so we measure the timezone's offset at that
// moment and subtract it. One pass is accurate except in the rare hour of a
// daylight-saving switch.
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = asIfUtc - guess; // how far the timezone is ahead of UTC
  return new Date(guess - offset);
}

// Format a Date as an iCalendar UTC timestamp: 20260704T130000Z
function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// A third tool: draft a calendar hold as a paste-ready .ics invite.
server.registerTool(
  "draft_calendar_hold",
  {
    title: "Draft a calendar hold (.ics)",
    description:
      "Create a calendar invite for a meeting at a given local date and time. Returns a ready-to-save .ics file. Use when asked to set up, hold, or block a meeting.",
    inputSchema: {
      title: z.string().describe("Meeting title, e.g. 'Intro call'"),
      date: z.string().describe("Date as YYYY-MM-DD"),
      startTime: z.string().describe("Local start time as HH:MM (24-hour)"),
      timezone: z
        .string()
        .describe("IANA timezone of the start time, e.g. 'Europe/Berlin'"),
      durationMinutes: z
        .number()
        .min(1)
        .optional()
        .describe("Length in minutes. Default 30."),
      location: z.string().optional().describe("Location or meeting link."),
      notes: z.string().optional().describe("Anything to add to the description."),
    },
  },
  async ({ title, date, startTime, timezone, durationMinutes = 30, location, notes }) => {
    // Parse and validate the date + time.
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const tm = /^(\d{2}):(\d{2})$/.exec(startTime);
    if (!dm || !tm) {
      return {
        isError: true,
        content: [{ type: "text", text: "date must be YYYY-MM-DD and startTime must be HH:MM." }],
      };
    }
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    } catch {
      return {
        isError: true,
        content: [{ type: "text", text: `'${timezone}' is not a valid IANA timezone.` }],
      };
    }

    const start = zonedWallTimeToUtc(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], timezone);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    const escape = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ea-mcp-server//EN",
      "BEGIN:VEVENT",
      `UID:${randomUUID()}@ea-mcp-server`,
      `DTSTAMP:${icsStamp(new Date())}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end)}`,
      `SUMMARY:${escape(title)}`,
      location ? `LOCATION:${escape(location)}` : "",
      notes ? `DESCRIPTION:${escape(notes)}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");

    const readable = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(start);

    return {
      content: [
        {
          type: "text",
          text: `Calendar hold: "${title}", ${readable} ${timezone} for ${durationMinutes} min.\nSave the text below as a .ics file and open it, or attach it to an invite:\n\n${ics}`,
        },
      ],
    };
  }
);

// 3. Connect over stdio (how Claude launches and talks to the server).
const transport = new StdioServerTransport();
await server.connect(transport);

// Logs MUST go to stderr — stdout is reserved for the MCP protocol itself.
console.error(
  "ea-mcp-server running (stdio). Tools: time_in, working_hours_overlap, draft_calendar_hold"
);
