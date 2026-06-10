import { input } from "@inquirer/prompts";
import { type } from "arktype";
import { OpenAI } from "openai";
import { tools } from "./tools";

const model = "gpt-5.4-nano" as const;

type ResponseInput = OpenAI.Responses.ResponseInput;
type ResponseInputItem = OpenAI.Responses.ResponseInputItem;
type ResponseOutputItem = OpenAI.Responses.ResponseOutputItem;

type CarryForwardItem = Extract<
  ResponseOutputItem,
  { type: "message" | "function_call" | "reasoning" }
>;

type ToolCallItem = Extract<ResponseOutputItem, { type: "function_call" }>;

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
  item.type === "function_call";

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

const processInput = async (
  openai: OpenAI,
  prompt: string,
  conversation: ResponseInput,
) => {
  const response = await openai.responses.create({
    model,
    input: [...conversation, UserMessage(prompt)],
    tools,
  });
  // TODO: handle RateLimitError

  const inputs = response.output.filter(isCarryForwardItem);
  const toolCalls = response.output.filter(isToolCallItem);
  const toolOutputs: ResponseInputItem[] = [];

  if (!toolOutputs.length) return response.output_text;

  for (const item of toolCalls) {
    // TODO: run tool
    toolOutputs.push({
      type: "function_call_output",
      call_id: item.call_id,
      output: "TODO",
    });
  }

  const finalResponse = await openai.responses.create({
    model,
    input: [...inputs, ...toolOutputs],
    tools,
  });

  return finalResponse.output_text;
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
    console.log(response);
  }
};

main();
