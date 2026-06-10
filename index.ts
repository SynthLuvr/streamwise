import { input } from "@inquirer/prompts";
import { type } from "arktype";
import { tools } from "./tools";

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

const processInput = async (message: string, _conversation: string[]) =>
  message;

const main = async () => {
  const apiKey = OpenAIApiKey(process.env["OPENAI_API_KEY"]);
  if (apiKey instanceof type.errors) {
    console.error("OPENAI_API_KEY environment variable", apiKey.summary);
    process.exitCode = 1;
    return;
  }

  const conversation: string[] = [];
  console.debug("Loaded", tools.length, "tools");

  while (true) {
    const userInput = await getInput();
    if (isExit(userInput)) return;

    const response = await processInput(userInput, conversation);
    conversation.push(userInput);
    conversation.push(response);
    console.log(response);
  }
};

main();
