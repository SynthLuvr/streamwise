import { input } from "@inquirer/prompts";
import { type } from "arktype";
import { OpenAI } from "openai";
import { tools } from "./tools";

type ResponseInput = OpenAI.Responses.ResponseInput;

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
    model: "gpt-5.4-nano",
    input: [...conversation, UserMessage(prompt)],
    tools,
  });
  // TODO: handle RateLimitError

  return response.output_text;
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
