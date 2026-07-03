# EA MCP Server

An [MCP](https://modelcontextprotocol.io/) server that gives Claude a small set of executive-assistant superpowers. Connect it to Claude and it can answer timezone and scheduling questions by calling real code, not by guessing.

Built to solve the everyday friction of supporting an executive across timezones.

## What it does

The server exposes two tools. Claude decides when to call them based on what you ask.

| Tool | What it does |
|------|--------------|
| `time_in` | The current local time in any IANA timezone. |
| `working_hours_overlap` | Given two or more timezones, the hours today when everyone's working day overlaps. The answer to "when can we all meet?" |

### Example

Ask Claude:

> I need a call between someone in Berlin and someone in New York. When can we meet?

Claude calls `working_hours_overlap` and answers from this server:

```
Overlapping working hours (9:00-17:00 local) for Europe/Berlin, America/New_York:
13:00 UTC  (Berlin 15:00, New_York 09:00)
14:00 UTC  (Berlin 16:00, New_York 10:00)
```

If two zones can never align a normal workday, it says so plainly instead of inventing a slot.

## How it works

A single-file stdio MCP server in TypeScript.

1. Each tool is registered with a name, a description Claude reads to decide when to use it, and an input schema.
2. Inputs are validated with [zod](https://zod.dev/) before any logic runs, so a bad timezone returns a clean message instead of a crash.
3. Claude launches the server and talks to it over stdio. All logging goes to stderr, because stdout carries the MCP protocol.

Timezone maths uses the platform `Intl` API, so there are no data files to keep current.

## Run it

```bash
npm install
npm run build
```

Connect it to Claude Code:

```bash
claude mcp add ea-mcp -- node /absolute/path/to/ea-mcp-server/dist/index.js
```

Then start a new Claude session and ask a scheduling question. Any MCP client works the same way: point it at `node dist/index.js`.

Scripts: `npm run dev` runs straight from TypeScript, `npm run build` compiles to `dist/`, `npm run start` runs the compiled server.

## Tech

TypeScript, the official `@modelcontextprotocol/sdk`, zod for input validation, the platform `Intl` API for timezones. No external services, no API keys.

## Roadmap

More tools an assistant actually reaches for: next free slot, draft a calendar hold, a quick meeting brief.

---

Built by Lisa Myburgh. Part of an AI implementation and enablement portfolio.
