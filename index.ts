import { input } from "@inquirer/prompts";
import { type } from "arktype";
import ky from "ky";
import { OpenAI } from "openai";
import { tools } from "./tools";

const model = "gpt-5.4-nano" as const;

const api = ky.create({
  baseUrl: "https://elyos-interview-907656039105.europe-west2.run.app",
  headers: {
    "X-API-Key": "elyos2025",
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
  try {
    return (await input({ message: "Ask anything" })).trim();
  } catch {
    return false;
  }
};

const isExit = (message: string | false): message is false => {
  if (message === false) return true;
  if (["", "quit", "exit", "q"].includes(message)) return true;
  return false;
};

// TODO: add retry and error handling; return "unknown error" if unable to
// handle
const callApi = async (
  endpoint: string,
  searchParams: Record<string, string>,
) => await api.get(endpoint, { searchParams }).text();

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
  console.debug("Researching", args.topic);
  return callApi("/research", args);
};

const runTool = (tool: ToolCallItem) => {
  if (tool.name === "get_weather") return runWeather(tool);
  if (tool.name === "research_topic") return runResearch(tool);

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
  const apiKey = OpenAIApiKey(process.env["OPENAI_API_KEY"]);
  if (apiKey instanceof type.errors) {
    console.error("OPENAI_API_KEY environment variable", apiKey.summary);
    process.exitCode = 1;
    return;
  }

  const openai = new OpenAI({ apiKey });
  const conversation: ResponseInput = [];
  console.debug("Loaded", tools.length, "tools");

  while (true) {
    const prompt = await getInput();
    if (isExit(prompt)) return;

    const response = await processInput(openai, prompt, conversation);
    conversation.push(UserMessage(prompt));
    conversation.push(AssistantMessage(response));
  }
};

main();
