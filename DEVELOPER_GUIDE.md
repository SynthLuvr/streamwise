# Streamwise — Developer Guide

> **TL;DR:** CLI chatbot bridging OpenAI’s Responses API with weather
> and research APIs. Handles streaming, tool-calling, `SIGINT`
> cancellation, retries, and graceful API error handling.

## 1. Project Overview

Interactive command-line chat application that:

- Accepts free-text prompts in a REPL-style loop.
- Sends the conversation to **OpenAI’s Responses API** (`gpt-4.1-nano`)
  with streaming.
- Lets the LLM call **two external tools** — weather and research —
  backed by a remote API.
- Executes tools, feeds results back to the LLM, and streams the answer.
- Supports **cancellation** during LLM streaming and tool execution via
  `SIGINT` (Ctrl+C).

All logic lives in `cli.ts` (~277 lines). Tool definitions are in
`tools.ts`.

## 2. Tech Stack

| Category | Technology | Notes |
|----|----|----|
| **Runtime** | Node.js 24 | Required (`engines` field in `package.json`) |
| **Package Manager** | pnpm 11.5.3 | Enforced via `packageManager` field |
| **Language** | TypeScript 6 | Strict mode, ESNext target, ES modules |
| **Execution** | tsx | Runs `.ts` files directly without a build step |
| **LLM Client** | openai v6 | Uses the **Responses API** (`openai.responses.create`) |
| **HTTP Client** | ky v2 | Used for calling the Elyos weather/research API |
| **CLI UI** | @clack/prompts | Input prompts, logging, and outro |
| **Spinner** | yocto-spinner | Shown during tool execution (handles `SIGINT` manually) |
| **Validation** | arktype v2 | Runtime type checking for env vars and tool arguments |
| **Testing** | vitest v4 | Minimal — one test file |
| **Linting** | Biome v2, oxlint | Biome also handles formatting |
| **Code Tools** | ast-grep, convert-to-arrow | Automated refactoring scripts (`strip-braces` is a custom ast-grep rule) |

## 3. Prerequisites & Setup

### Environment Variables

| Variable | Purpose | Validation |
|----|----|----|
| `OPENAI_API_KEY` | Authenticates with the OpenAI API | Must match regex `sk-(proj-)?[a-z0-9_-]{20,}` |
| `ELYOS_API_KEY` | Sent as `X-API-Key` header to the Elyos API | Must be non-empty |

### Installation & Running

``` bash
# Install dependencies
pnpm install

# Run the CLI (recommended — preserves SIGINT handling)
node --import tsx cli.ts

# Alternative (swallows SIGINT — not recommended)
pnpm tsx cli.ts
```

> **Why `node --import tsx` instead of `pnpm tsx`?** `pnpm tsx` swallows
> `SIGINT` signals, breaking cancellation. See [Known
> Issues](#14-known-issues--gotchas).

1.  [Project Overview](#1-project-overview)
2.  [Tech Stack](#2-tech-stack)
3.  [Prerequisites & Setup](#3-prerequisites--setup)
4.  [Project Structure](#4-project-structure)
5.  [Architecture & Design](#5-architecture--design)
6.  [Core Modules Deep Dive](#6-core-modules-deep-dive)
7.  [The Conversation Loop](#7-the-conversation-loop)
8.  [Tool Calling System](#8-tool-calling-system)
9.  [API Layer & Retry Logic](#9-api-layer--retry-logic)
10. [Streaming & Cancellation](#10-streaming--cancellation)
11. [Type System & Validation](#11-type-system--validation)
12. [Linting, Formatting & Code
    Style](#12-linting-formatting--code-style)
13. [Testing](#13-testing)
14. [Known Issues & Gotchas](#14-known-issues--gotchas)
15. [Extending the Project](#15-extending-the-project)

## 4. Project Structure

    streamwise/
    ├── cli.ts              # Main application — all CLI logic, conversation loop, streaming
    ├── tools.ts            # OpenAI tool/function definitions (get_weather, research_topic)
    ├── basic.test.ts       # Verifies 2 tools exported with correct type
    ├── package.json        # Dependencies, scripts, engine constraints
    ├── tsconfig.json       # TypeScript config (strict, ESNext, noEmit)
    ├── biome.json          # Biome linter/formatter rules
    ├── .oxlintrc.json      # oxlint rules
    ├── vitest.config.ts    # Vitest config (defaults only)
    ├── pnpm-workspace.yaml # Build allowlist for native packages
    ├── pnpm-lock.yaml      # Lock file
    └── README.md           # User-facing docs

**No `src/` directory, no nested modules.** Everything is co-located in
the root.

## 5. Architecture & Design

### High-Level Flow

    ┌─────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
    │  User   │────▶│  Clack Input │────▶│  OpenAI LLM  │────▶│ Tool Calls?  │
    │  Input  │     │   Prompt     │     │  (streaming) │     │              │
    └─────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                      │
                                                             ┌────────┴────────┐
                                                             │                 │
                                                        No tools          Has tools
                                                             │                 │
                                                             ▼                 ▼
                                                      Stream text      Execute each tool
                                                      to terminal      via Elyos API
                                                             │                 │
                                                             ▼                 ▼
                                                      Add to           Feed results back
                                                      conversation      to LLM → stream
                                                                       final answer

### Design Philosophy

- **No abstractions.** No `Agent` class, no `Provider` interface, no
  `ToolRunner` registry.
- **Not model-agnostic.** Uses the `openai` package and Responses API
  directly.
- **Single file for logic.** `cli.ts` contains everything — types, API
  clients, conversation loop, tool dispatch, streaming.
- **Type safety as guardrails.** `never` checks, arktype runtime
  validation, and discriminated unions make invalid states
  unrepresentable.

## 6. Core Modules Deep Dive

### `cli.ts` — The Entire Application (~277 lines)

#### 6.1 Type Definitions (lines 8–22)

``` typescript
type ResponseInput       // OpenAI SDK: full input array
type ResponseInputItem   // OpenAI SDK: individual input items
type ResponseOutputItem  // OpenAI SDK: individual output items

type CarryForwardItem    // Items carried between turns: message | function_call | reasoning
type ToolCallItem        // function_call narrowed to get_weather | research_topic
type Message             // { role, content }
```

`CarryForwardItem` determines which output items survive into the next
API call — messages, function calls, and reasoning. Other output types
are dropped.

#### 6.2 Constants & Config (lines 23–36)

- **Model**: `gpt-4.1-nano`
- **Base URL**:
  `https://elyos-interview-907656039105.europe-west2.run.app`
- **Auth**: `X-API-Key` header from `ELYOS_API_KEY`
- **Retry** (ky built-in): 3 attempts, 1s backoff limit, jitter, retry
  on timeout

#### 6.3 Helper Functions (lines 38–74)

| Function | Purpose |
|----|----|
| `AssistantMessage(str)` | `{ role: "assistant", content: str }` |
| `UserMessage(str)` | `{ role: "user", content: str }` |
| `isCarryForwardItem(item)` | Type guard for message/function_call/reasoning |
| `isToolCallItem(item)` | Type guard for get_weather/research_topic |
| `getInput()` | Clack text prompt, returns `false` on cancel |
| `isExit(msg)` | `true` for `"quit"`, `"exit"`, `"q"`, `""`, or `false` |

#### 6.4 Validation Schemas

`OpenAIApiKey` (line 48) uses arktype’s `"=>"` morph syntax:

``` typescript
const OpenAIApiKey = type("string > 20", "=>", type(/^sk-(?:proj-)?[a-z0-9_-]{20,}$/i));
```

JSON argument schemas (lines 104–106) use `.pipe()` chains:

``` typescript
const JsonArguments = type("string").pipe((v) => JSON.parse(v));
const WeatherArguments = JsonArguments.pipe(type({ location: "string" }));
const ResearchArguments = JsonArguments.pipe(type({ topic: "string" }));
```

These parse JSON strings and validate shape in one expression.

## 7. The Conversation Loop

The `main()` function (lines 246–275) is the entry point:

    main()
      │
      ├─ Validate ELYOS_API_KEY (non-empty)
      ├─ Validate OPENAI_API_KEY (matches sk-* pattern)
      ├─ Create OpenAI client
      ├─ Initialize empty conversation[]
      │
      └─ while (true)
           ├─ getInput() → text prompt
           ├─ isExit()? → outro("Goodbye!") → return
           │
           ├─ processInput(openai, prompt, conversation)
           │     │
           │     ├─ Build currentInput = [...conversation, UserMessage(prompt)]
           │     ├─ streamOpenAIResponse() → 1st LLM call (may return tool calls)
           │     │
           │     ├─ If no tool calls → stream text, add newline, return
           │     │
           │     ├─ For each tool call:
           │     │   ├─ runTool() → calls Elyos API with spinner
           │     │   └─ Collect function_call_output items
           │     │
           │     └─ streamOpenAIResponse() → 2nd LLM call with tool results
           │           └─ Stream final answer, return
           │
           ├─ conversation.push(UserMessage(prompt))
           └─ conversation.push(AssistantMessage(response))

### Two LLM Calls Per Turn (When Tools Are Used)

1.  **First call** — user prompt sent; LLM returns function calls.
2.  **Tool execution** — each call runs against the Elyos API.
3.  **Second call** — conversation + tool outputs sent; LLM streams the
    final response.

Without tool calls, only one API request is made.

## 8. Tool Calling System

### `tools.ts` — Tool Definitions

The `tools` array exports two function definitions for the Responses
API. Both use `strict: true` (LLM must adhere to the parameter schema
exactly).

#### `get_weather`

- **Description**: “Get current weather for a city. Fast response.”
- **Parameters**: `{ location: string }` (required)

#### `research_topic`

- **Description**: “Research a topic in depth. Takes 3-8 seconds. Use
  for questions requiring detailed research.”
- **Parameters**: `{ topic: string }` (required)

### Tool Dispatch (`runTool` in `cli.ts`)

Dispatch is a series of `if` checks, not a registry:

``` typescript
const runTool = async (tool: ToolCallItem) => {
  // 1. Create spinner with handleSignals: false (custom SIGINT handling)
  // 2. Create AbortController for cancellation
  // 3. Register SIGINT handler to stop spinner + abort
  // 4. Dispatch based on tool.name:
  //    - "get_weather"    → runWeather(tool, controller)
  //    - "research_topic" → runResearch(tool, controller)
  // 5. Exhaustiveness check: `const unreachable: never = tool.name`
}
```

The `never` assignment is an exhaustiveness check — adding a tool to
`ToolCallItem` without handling it here is a compile error.

### Argument Parsing

Arguments arrive as JSON strings from the LLM. Parsed + validated in one
step via arktype:

``` typescript
const args = WeatherArguments.assert(tool.arguments);
// WeatherArguments = type("string") → JSON.parse → type({ location: "string" })
```

If the arguments don’t match, `.assert()` throws.

## 9. API Layer & Retry Logic

### Elyos API (Remote)

| Endpoint    | Method | Params             | Purpose                  |
|-------------|--------|--------------------|--------------------------|
| `/weather`  | GET    | `?location=<city>` | Current weather          |
| `/research` | GET    | `?topic=<topic>`   | In-depth research (3–8s) |

### Two-Layer Retry Strategy

**Layer 1 — ky built-in retries (network level):**

``` typescript
retry: {
  backoffLimit: 1000,   // max 1 second between retries
  jitter: true,         // randomized backoff
  limit: 3,             // max 3 attempts
  retryOnTimeout: true,
}
```

Handles transient HTTP failures (timeouts, 5xx, network errors).

**Layer 2 — Application-level retry (empty response handling):**

`callApi()` wraps every tool API call in a 3-attempt loop:

``` typescript
for (let i = 0; i < 3; i++) {
  response = (await callApi()).trim();
  if (!response || response === "{}")
    log.warn("Received empty response. Will retry");
  else return response;
}
```

Catches `200 OK` with empty body or `{}` — a known issue with
`/research`.

### Error Handling

`ky` errors are caught; their `message` field is extracted via arktype:

``` typescript
} catch (e) {
  const error = type({ message: "string" }).assert(e);
  return error.message;  // returned as tool output to the LLM
}
```

**Error messages become tool output**, letting the LLM inform the user
instead of crashing the CLI.

## 10. Streaming & Cancellation

### How Streaming Works (`streamOpenAIResponse`)

Creates an OpenAI streaming response and iterates over events:

``` typescript
const stream = await openai.responses.create(
  { model, input, tools, stream: true },
  { signal: controller.signal },  // AbortController signal
);

for await (const event of stream) {
  switch (event.type) {
    case "response.output_text.delta":
      // Write chunk to stdout immediately + accumulate
      process.stdout.write(event.delta);
      outputText += event.delta;
      break;

    case "response.completed":
      // Full output array (messages, function_calls, reasoning)
      output = event.response.output;
      break;

    case "response.failed":
      // Log error (with fallback message)
      break;
  }
}
```

Text deltas are written directly to `process.stdout` — the user sees
text appear in real-time.

### Cancellation via SIGINT (Ctrl+C)

Handled at **two levels**:

#### Level 1: During LLM Streaming

``` typescript
process.once("SIGINT", onSigint);
// onSigint: sets cancelled=true, aborts the controller,
//           prints "\nCancelled\n"
// ...
process.off("SIGINT", onSigint);  // cleanup in finally block
```

Uses `process.once` — a single SIGINT triggers cancellation. The
listener is removed in the `finally` block, preventing dangling
listeners across turns.

#### Level 2: During Tool Execution

``` typescript
// In runTool():
process.on("SIGINT", () => {
  s.stop("Cancelled");
  controller.abort();
});
```

Uses `process.on` — this listener is **never removed** (see [Known
Issues](#14-known-issues--gotchas)).

#### Why `yocto-spinner` Instead of `@clack/prompts` Spinner

`@clack/prompts` spinner calls `process.exit()` on SIGINT, killing the
CLI. `yocto-spinner` with `handleSignals: false` gives manual control.

## 11. Type System & Validation

### TypeScript Types

The app narrows OpenAI SDK types:

``` typescript
// From OpenAI SDK
OpenAI.Responses.ResponseInput         // Full input array
OpenAI.Responses.ResponseInputItem     // Individual input items
OpenAI.Responses.ResponseOutputItem    // Individual output items

// Custom narrowed types
CarryForwardItem = Extract<OutputItem, { type: "message" | "function_call" | "reasoning" }>
ToolCallItem     = Extract<OutputItem, { type: "function_call" }> & { name: "get_weather" | "research_topic" }
```

`Extract` narrows the SDK’s broad union types into discriminated unions.

### arktype Runtime Validation

[arktype](https://arktype.io/) handles **runtime** validation (env vars,
API responses, LLM-generated arguments):

| Schema | Validates | Pattern |
|----|----|----|
| `OpenAIApiKey` | `OPENAI_API_KEY` | `type("string > 20", "=>", type(/^sk-.../i))` |
| (inline) | `ELYOS_API_KEY` | `type("string > 0")(value)` |
| `JsonArguments` | JSON string | `type("string").pipe((v) => JSON.parse(v))` |
| `WeatherArguments` | Tool arguments | `JsonArguments.pipe(type({ location: "string" }))` |
| `ResearchArguments` | Tool arguments | `JsonArguments.pipe(type({ topic: "string" }))` |

`.pipe()` chains steps — parse JSON, then validate shape. `.assert()`
throws on failure.

### Exhaustiveness Checking

Uses TypeScript’s `never` type for exhaustiveness (see Section 8):

``` typescript
const unreachable: never = tool.name;
throw unreachable;
```

## 12. Linting, Formatting & Code Style

| Tool | Config | Purpose |
|----|----|----|
| Biome | `biome.json` | Linter + formatter. Custom rules (no recommended preset). Enforces `useArrowFunction`, `useConst`, `noExplicitAny`, etc. |
| oxlint | `.oxlintrc.json` | Type-aware linter. Rules: `no-floating-promises`, `return-await`. Uses `oxlint-tsgolint`. |

**Formatting scripts** (`pnpm format`):

1.  `convert-to-arrow` — converts function expressions to arrow
    functions
2.  `strip-braces` — custom ast-grep rule removing braces from
    single-statement blocks
3.  Biome format + check

Run `pnpm lint` to check, `pnpm format` to fix.

## 13. Testing

Single test file: `basic.test.ts`. Verifies `tools` array exports 2
function-type tools.

``` bash
pnpm test        # run once
```

CI runs on PRs: build → lint → test (`.github/workflows/ci.yml`).

## 14. Known Issues & Gotchas

- **`pnpm tsx` swallows SIGINT.** Use `node --import tsx cli.ts` to
  preserve cancellation.
- **`runTool()` SIGINT listener never removed.** Uses `process.on` (not
  `once`) with no cleanup. Multiple tool calls accumulate listeners.
- **`callApi()` inner function shadows outer.** The inner `callApi`
  (line 81) shadows the outer `callApi` (line 76). Works but confusing.
- **`/research` returns empty bodies.** The app retries up to 3 times on
  empty/`{}` responses.

## 15. Extending the Project

**Add a new tool:**

1.  Add definition to `tools.ts` (follow existing pattern).
2.  Add tool name to `ToolCallItem` union in `cli.ts`.
3.  Update `isToolCallItem()` type guard.
4.  Add `run<Name>()` function and dispatch branch in `runTool()`.
5.  Add arktype argument schema.
6.  The `never` exhaustiveness check will error if step 4 is missed.

**Swap the model:** Change `const model` (line 23). Ensure the model
supports the Responses API and tool calling.
