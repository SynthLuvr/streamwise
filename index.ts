import { isCancel, log, outro, spinner, text } from "@clack/prompts";
import { type } from "arktype";
import ky from "ky";
import { OpenAI } from "openai";
import pRetry from "p-retry";
import { tools } from "./tools";

const model = "gpt-5.4-nano" as const;

const api = ky.create({
  baseUrl: "https://elyos-interview-907656039105.europe-west2.run.app",
  headers: {
    "X-API-Key": process.env["ELYOS_API_KEY"] ?? "",
  },
  retry: {
    backoffLimit: 1000,
    jitter: true,
    limit: 3,
    retryOnTimeout: true,
  },
});

type ResponseInput = OpenAI.Responses.ResponseInput;
type ResponseInputItem = OpenAI.Responses.ResponseInputItem;
type ResponseOutputItem = OpenAI.Responses.ResponseOutputItem;

type CarryForwardItem = Extract<
  ResponseOutputItem,
  { type: "message" | "function_call" | "reasoning" }
>;

type ToolCallItem = Extract<ResponseOutputItem, { type: "function_call" }> & {
  name: "get_weather" | "research_topic";
};

type Message = {
  role: "assistant" | "user";
  content: string;
};

const AssistantMessage = (message: string): Message => ({
  role: "assistant",
  content: message,
});

const UserMessage = (message: string): Message => ({
  role: "user",
  content: message,
});

const OpenAIApiKey = type(
  "string > 20",
  "=>",
  type(/^sk-(?:proj-)?[a-z0-9_-]{20,}$/i),
);

const isCarryForwardItem = (
  item: ResponseOutputItem,
): item is CarryForwardItem =>
  item.type === "message" ||
  item.type === "function_call" ||
  item.type === "reasoning";

const isToolCallItem = (item: ResponseOutputItem): item is ToolCallItem =>
  item.type === "function_call" &&
  (item.name === "get_weather" || item.name === "research_topic");

const getInput = async () => {
  const value = await text({ message: "Ask anything" });
  if (isCancel(value)) return false;
  return value.trim();
};

const isExit = (message: string | false): message is false => {
  if (message === false) return true;
  if (["", "quit", "exit", "q"].includes(message)) return true;
  return false;
};

const callApi = async (
  endpoint: string,
  searchParams: Record<string, string>,
) => {
  try {
    return await pRetry(() => api.get(endpoint, { searchParams }).text());
  } catch (e) {
    const error = type({ message: "string" }).assert(e);
    return error.message;
  }
};

const JsonArguments = type("string").pipe((v) => JSON.parse(v));

const WeatherArguments = JsonArguments.pipe(
  type({
    location: "string",
  }),
);

const runWeather = async (tool: ToolCallItem) => {
  const args = WeatherArguments.assert(tool.arguments);
  return callApi("/weather", args);
};

const ResearchArguments = JsonArguments.pipe(
  type({
    topic: "string",
  }),
);

const runResearch = async (tool: ToolCallItem) => {
  const args = ResearchArguments.assert(tool.arguments);
  log.info(`Researching ${args.topic}`);
  return callApi("/research", args);
};

const runTool = async (tool: ToolCallItem) => {
  const s = spinner();

  if (tool.name === "get_weather") {
    s.start("Calling weather tool");
    const output = await runWeather(tool);
    s.stop("Retrieved weather");
    return output;
  }

  if (tool.name === "research_topic") {
    s.start("Calling research tool");
    const output = await runResearch(tool);
    s.stop("Retrieved research");
    return output;
  }

  const unreachable: never = tool.name;
  throw unreachable;
};

const streamOpenAIResponse = async (
  openai: OpenAI,
  input: ResponseInput,
): Promise<{
  outputText: string;
  output: ResponseOutputItem[];
}> => {
  const stream = await openai.responses.create({
    model,
    input,
    tools,
    stream: true,
  });

  let outputText = "";
  let output: ResponseOutputItem[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta": {
        process.stdout.write(event.delta);
        outputText += event.delta;
        break;
      }

      case "response.completed": {
        output = event.response.output;
        break;
      }

      case "response.failed": {
        throw new Error(
          event.response.error?.message ?? "OpenAI response failed",
        );
      }

      default:
        break;
    }
  }

  return { outputText, output };
};

const processInput = async (
  openai: OpenAI,
  prompt: string,
  conversation: ResponseInput,
) => {
  const currentInput: ResponseInput = [...conversation, UserMessage(prompt)];
  const firstResponse = await streamOpenAIResponse(openai, currentInput);

  const inputs = firstResponse.output.filter(isCarryForwardItem);
  const toolCalls = firstResponse.output.filter(isToolCallItem);
  const toolOutputs: ResponseInputItem[] = [];

  if (!toolCalls.length) {
    process.stdout.write("\n");
    return firstResponse.outputText;
  }

  for (const item of toolCalls) {
    const response = await runTool(item);
    toolOutputs.push({
      type: "function_call_output",
      call_id: item.call_id,
      output: response,
    });
  }

  const finalResponse = await streamOpenAIResponse(openai, [
    ...currentInput,
    ...inputs,
    ...toolOutputs,
  ]);

  process.stdout.write("\n");
  return finalResponse.outputText;
};

const main = async () => {
  const elyosApiKey = type("string > 0")(process.env["ELYOS_API_KEY"]);
  if (elyosApiKey instanceof type.errors) {
    log.error(`ELYOS_API_KEY environment variable ${elyosApiKey.summary}`);
    process.exitCode = 1;
    return;
  }

  const apiKey = OpenAIApiKey(process.env["OPENAI_API_KEY"]);
  if (apiKey instanceof type.errors) {
    log.error(`OPENAI_API_KEY environment variable ${apiKey.summary}`);
    process.exitCode = 1;
    return;
  }

  const openai = new OpenAI({ apiKey });
  const conversation: ResponseInput = [];

  while (true) {
    const prompt = await getInput();
    if (isExit(prompt)) {
      outro("Goodbye!");
      return;
    }

    const response = await processInput(openai, prompt, conversation);
    conversation.push(UserMessage(prompt));
    conversation.push(AssistantMessage(response));
  }
};

void main();
