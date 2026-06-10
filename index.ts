import { input } from "@inquirer/prompts";
import { type } from "arktype";
import { tools } from "./tools";

type Role = "assistant" | "user";

type Message = {
  role: Role;
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

const processInput = async (message: string, _conversation: Message[]) =>
  message;

const main = async () => {
  const apiKey = OpenAIApiKey(process.env["OPENAI_API_KEY"]);
  if (apiKey instanceof type.errors) {
    console.error("OPENAI_API_KEY environment variable", apiKey.summary);
    process.exitCode = 1;
    return;
  }

  const conversation: Message[] = [];
  console.debug("Loaded", tools.length, "tools");

  while (true) {
    const prompt = await getInput();
    if (isExit(prompt)) return;

    const response = await processInput(prompt, conversation);
    conversation.push(UserMessage(prompt));
    conversation.push(AssistantMessage(response));
    console.log(response);
  }
};

main();
