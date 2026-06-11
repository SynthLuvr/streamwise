# Streamwise

A streaming CLI chat app that integrates LLM tool calling with
real-world weather and research APIs, including pending states,
cancellation, and graceful handling of messy API behavior.

## Usage

Before running the CLI, make sure the following environment variables
are set:

``` bash
ELYOS_API_KEY=...
OPENAI_API_KEY=...
```

Run the CLI with:

``` bash
node --import tsx cli.ts
```

You can also run it with:

``` bash
pnpm tsx cli.ts
```

However, `pnpm tsx cli.ts` swallows `SIGINT` signals, which changes the
CLI behavior. For that reason, `node --import tsx cli.ts` is
recommended.

## Implementation Notes

This project uses the `openai` package directly and is not
model-agnostic.

The implementation intentionally avoids extra abstractions to keep the
code simple. Supporting additional models in the future would likely
require introducing a new abstraction layer.

The main implementation struggle was getting TypeScript to work smoothly
with streaming output while also correctly handling `SIGINT`. Python
would probably have been the more appropriate choice for this kind of
CLI, but I wanted to build it quickly and already had TypeScript tooling
readily available.

## Spinner Behavior

The CLI uses `yocto-spinner` instead of the `spinner` from
`@clack/prompts`.

The `@clack/prompts` spinner gets most of the way there with minimal
boilerplate, but it directly calls `process.exit` when `SIGINT` is
received. That terminates the prompt, which is not the desired behavior
for this CLI.

## API Notes

The main API issue observed is with the `/research` endpoint.

Sometimes, the `/research` endpoint returns generic information
regardless of which topic is selected. In some cases, it also returns an
empty response. To handle this, retry behavior was added.

There were also cases where the `/research` endpoint appeared to return
a cached response, but this did not seem to interfere with the final
results.

Standard retry logic is included for intermittent failures.

## Output

Responses are streamed directly to the CLI.

Markdown is shown as plain, unformatted text in the console. Formatting
the markdown output was avoided to keep the implementation simple.

### Testing

Tests have not been added for this project.

The original specification indicated that tests were not required, so I
intentionally kept the implementation as simple as possible and avoided
spending additional time on test infrastructure.

Testing an interactive streaming CLI also requires a fair amount of
setup and boilerplate, particularly around mocking stdin/stdout,
handling streaming responses, and simulating `SIGINT` behavior. Given
the scope of the task, I prioritized the core functionality and
robustness of the implementation over automated test coverage.
