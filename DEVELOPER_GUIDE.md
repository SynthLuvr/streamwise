# Streamwise — Developer Guide

> **TL;DR:** Streamwise is a streaming CLI chatbot that bridges OpenAI’s
> LLM tool-calling with real-world weather and research APIs. It handles
> pending states, cancellation via `SIGINT`, retries, and graceful
> degradation from messy API responses.

------------------------------------------------------------------------

## 1. Project Overview

Streamwise is an interactive command-line chat application that:

- Accepts free-text prompts from the user in a REPL-style loop.
- Sends the conversation to **OpenAI’s Responses API** (`gpt-5.4-nano`)
  with streaming enabled.
- Allows the LLM to call **two external tools** — weather lookup and
  topic research — which are backed by a remote API.
- Handles **tool execution**, feeds results back to the LLM, and streams
  the final answer to the terminal.
- Supports **cancellation** at both the LLM streaming level and the
  tool-execution level via `SIGINT` (Ctrl+C).

The project intentionally avoids heavy abstractions. All logic lives in
a single `cli.ts` file (~277 lines), with tool definitions separated
into `tools.ts`.

------------------------------------------------------------------------

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
| **Linting** | Biome v2, oxlint | Two linters; Biome also handles formatting |
| **Code Tools** | ast-grep, convert-to-arrow, strip-braces | Automated refactoring/formatting scripts |

------------------------------------------------------------------------

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

> **Why `node --import tsx` instead of `pnpm tsx`?**  
> `pnpm tsx` swallows `SIGINT` signals, which breaks the cancellation
> behavior that is core to this app. See [Known
> Issues](#14-known-issues--gotchas).

------------------------------------------------------------------------

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

------------------------------------------------------------------------

## 4. Project Structure

    streamwise/
    ├── cli.ts              # Main application — all CLI logic, conversation loop, streaming
    ├── tools.ts            # OpenAI tool/function definitions (get_weather, research_topic)
    ├── basic.test.ts       # Single test: verifies 2 tools are exported with correct type
    ├── package.json        # Dependencies, scripts, engine constraints
    ├── tsconfig.json       # TypeScript config (strict, ESNext, noEmit)
    ├── biome.json          # Biome linter/formatter rules (heavily customized)
    ├── vitest.config.ts    # Vitest config (empty options — defaults only)
    ├── pnpm-workspace.yaml # Build allowlist for native packages
    ├── pnpm-lock.yaml      # Lock file
    └── README.md           # User-facing docs

The project is intentionally flat — **no `src/` directory, no nested
modules**. Everything is co-located in the root.

------------------------------------------------------------------------

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

- **No unnecessary abstractions.** There is no `Agent` class, no
  `Provider` interface, no `ToolRunner` registry. Functions call
  functions. This was a deliberate choice for speed and simplicity.
- **Not model-agnostic.** The code uses the `openai` package directly
  and the Responses API. Supporting other providers would require
  introducing an abstraction layer.
- **Single file for logic.** `cli.ts` contains the entire application.
  Type definitions, API clients, the conversation loop, tool dispatch,
  and streaming are all inline.
- **Type safety as guardrails.** TypeScript `never` checks, arktype
  runtime validation, and discriminated unions are used to make invalid
  states unrepresentable.

------------------------------------------------------------------------

## 6. Core Modules Deep Dive

### `cli.ts` — The Entire Application (~277 lines)

This file contains everything. Here’s a breakdown of its sections in
order of appearance:

#### 6.1 Type Definitions (lines 1–28)

``` typescript
// Re-exports of OpenAI SDK types for convenience
type ResponseInput       // What goes INTO the API
type ResponseInputItem   // Individual input items
type ResponseOutputItem  // Individual output items

// Narrowed types specific to this app
type CarryForwardItem    // Items to carry between turns: message | function_call | reasoning
type ToolCallItem        // Specifically get_weather or research_topic function calls
type Message             // Simple { role, content } pair
```

The `CarryForwardItem` type is critical — it determines which parts of
the LLM’s output get carried into the next API call. The app keeps
messages, function calls, and reasoning items, but silently drops other
output types.

#### 6.2 Constants & Config (lines 30–41)

``` typescript
const model = "gpt-5.4-nano" as const;
```

The `ky` HTTP client is configured once with: - **Base URL**:
`https://elyos-interview-907656039105.europe-west2.run.app` - **Auth**:
`X-API-Key` header from `ELYOS_API_KEY` env var - **Retry**: up to 3
retries, 1s backoff limit, jitter enabled, retry on timeout

#### 6.3 Helper Functions (lines 43–63)

| Function | Purpose |
|----|----|
| `AssistantMessage(str)` | Creates `{ role: "assistant", content: str }` |
| `UserMessage(str)` | Creates `{ role: "user", content: str }` |
| `isCarryForwardItem(item)` | Type guard: filters for message/function_call/reasoning |
| `isToolCallItem(item)` | Type guard: filters for get_weather/research_topic |
| `getInput()` | Shows Clack text prompt, returns `false` on cancel |
| `isExit(msg)` | Returns `true` for `"quit"`, `"exit"`, `"q"`, `""`, or `false` |

#### 6.4 Validation Schemas (lines 82–86)

arktype is used for runtime validation:

``` typescript
const OpenAIApiKey = type("string > 20").pipe(type(/^sk-(?:proj-)?[a-z0-9_-]{20,}$/i));
const JsonArguments = type("string").pipe((v) => JSON.parse(v));
const WeatherArguments = JsonArguments.pipe(type({ location: "string" }));
const ResearchArguments = JsonArguments.pipe(type({ topic: "string" }));
```

These chains parse JSON strings and validate the resulting object shape
in one expression.

------------------------------------------------------------------------

## 7. The Conversation Loop

The `main()` function (lines 230–255) is the entry point:

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

### Key Detail: Two LLM Calls Per Turn

When the LLM decides to use a tool, a single user turn requires **two
OpenAI API calls**:

1.  **First call** — The user prompt is sent. The LLM responds with
    function calls instead of text.
2.  **Tool execution** — Each function call is executed against the
    Elyos API.
3.  **Second call** — The conversation + tool outputs are sent back. The
    LLM streams a natural-language response incorporating the tool
    results.

If no tools are called, only one API request is made.

------------------------------------------------------------------------

## 8. Tool Calling System

### `tools.ts` — Tool Definitions

The `tools` array exports two function definitions compatible with
OpenAI’s Responses API:

#### `get_weather`

- **Description**: “Get current weather for a city. Fast response.”
- **Parameters**: `{ location: string }` (required)
- **Strict mode**: `true` — the LLM is guaranteed to produce exactly
  this schema

#### `research_topic`

- **Description**: “Research a topic in depth. Takes 3-8 seconds.”
- **Parameters**: `{ topic: string }` (required)
- **Strict mode**: `true`

Both tools use `strict: true`, which forces the LLM to adhere exactly to
the parameter schema — no extra or missing fields.

### Tool Dispatch (`runTool` in `cli.ts`)

The dispatch is deliberately simple — a series of `if` checks, not a
registry:

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

The `never` assignment at the end is a TypeScript exhaustiveness pattern
— if a new tool is added to the `ToolCallItem` union but not handled
here, the compiler will error.

### Argument Parsing

Tool arguments arrive as JSON strings from the LLM. They are parsed +
validated in one step using arktype chains:

``` typescript
const args = WeatherArguments.assert(tool.arguments);
// WeatherArguments = type("string") → JSON.parse → type({ location: "string" })
```

If the arguments don’t match, `.assert()` throws.

------------------------------------------------------------------------

## 9. API Layer & Retry Logic

### Elyos API (Remote)

| Endpoint    | Method | Params             | Purpose                  |
|-------------|--------|--------------------|--------------------------|
| `/weather`  | GET    | `?location=<city>` | Current weather          |
| `/research` | GET    | `?topic=<topic>`   | In-depth research (3–8s) |

All calls go through the pre-configured `ky` client (see [Section
6.2](#62-constants--config-lines-30-41)).

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

This handles transient HTTP failures (timeouts, 5xx, network errors).

**Layer 2 — Application-level retry (empty response handling):**

The `callApi()` function wraps every tool API call with a custom
3-attempt loop:

``` typescript
for (let i = 0; i < 3; i++) {
  response = (await callApi()).trim();
  if (!response || response === "{}")
    log.warn("Received empty response. Will retry");
  else return response;
}
```

This catches the case where the API returns `200 OK` but with an empty
body or `{}` — a known issue with the `/research` endpoint.

### Error Handling

HTTP errors from `ky` are caught and their `message` field is extracted
via arktype:

``` typescript
} catch (e) {
  const error = type({ message: "string" }).assert(e);
  return error.message;  // returned as tool output to the LLM
}
```

This means **error messages are fed to the LLM as tool output**,
allowing the model to gracefully inform the user rather than crashing
the CLI.

------------------------------------------------------------------------

## 10. Streaming & Cancellation

### How Streaming Works (`streamOpenAIResponse`)

The function creates an OpenAI streaming response and iterates over
events:

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
      // Log error
      break;
  }
}
```

**Key detail:** Text deltas are written directly to `process.stdout` as
they arrive — the user sees text appear in real-time, character by
character.

### Cancellation via SIGINT (Ctrl+C)

Cancellation is handled at **two levels** with different strategies:

#### Level 1: During LLM Streaming

``` typescript
process.once("SIGINT", onSigint);
// onSigint: sets cancelled=true, aborts the controller,
//           prints "\nCancelled\n"
// ...
process.off("SIGINT", onSigint);  // cleanup in finally block
```

Uses `process.once` (not `on`) — a single SIGINT triggers cancellation
and the listener is removed in the `finally` block. This prevents
dangling listeners across conversation turns.

#### Level 2: During Tool Execution

``` typescript
// In runTool():
process.on("SIGINT", () => {
  s.stop("Cancelled");
  controller.abort();
});
```

Uses `process.on` (not `once`) — but note this listener is **never
removed**, which is a potential issue (see [Known
Issues](#14-known-issues--gotchas)).

#### Why `yocto-spinner` Instead of `@clack/prompts` Spinner

The `@clack/prompts` spinner calls `process.exit()` on SIGINT, which
would kill the entire CLI. `yocto-spinner` with `handleSignals: false`
gives manual control over signal handling.

------------------------------------------------------------------------

## 11. Type System & Validation

### TypeScript Types

The app leans heavily on OpenAI SDK types and narrows them:

``` typescript
// From OpenAI SDK
OpenAI.Responses.ResponseInput         // Full input array
OpenAI.Responses.ResponseInputItem     // Individual input items
OpenAI.Responses.ResponseOutputItem    // Individual output items

// Custom narrowed types
CarryForwardItem = Extract<OutputItem, { type: "message" | "function_call" | "reasoning" }>
ToolCallItem     = Extract<OutputItem, { type: "function_call" }> & { name: "get_weather" | "research_topic" }
```

The `Extract` utility type creates discriminated unions from the SDK’s
broad union types.

### arktype Runtime Validation

[arktype](https://arktype.io/) is used for **runtime** validation where
TypeScript can’t help (env vars, API responses, LLM-generated
arguments):

| Schema | Validates | Pattern |
|----|----|----|
| `OpenAIApiKey` | `OPENAI_API_KEY` env var | Non-empty string \>20 chars, then regex `sk-...` |
| `elyosApiKey` | `ELYOS_API_KEY` env var | Non-empty string |
| `JsonArguments` | Any JSON string | `type("string").pipe(v => JSON.parse(v))` |
| `WeatherArguments` | Tool arguments | `JsonArguments.pipe(type({ location: "string" }))` |
| `ResearchArguments` | Tool arguments | `JsonArguments.pipe(type({ topic: "string" }))` |

arktype’s `.pipe()` chains validation steps — parse JSON first, then
validate shape. The `.assert()` method throws on failure.

### Exhaustiveness Checking

The codebase uses TypeScript’s `never` type for exhaustiveness:

``` typescript
const unreachable: never = tool.name;
throw unreachable;
```

If a new tool name is added to the `ToolCallItem` union but the dispatch
logic isn’t updated, TypeScript will refuse to compile.
