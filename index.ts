import { input } from "@inquirer/prompts";
import { tools } from "./tools";

const getInput = async () => {
  try {
    return await input({ message: "Ask anything" });
  } catch {
    return false;
  }
};

const isExit = (message: string | false): message is false => {
  if (message === false) return true;
  if (["quit", "exit", "q"].includes(message)) return true;
  return false;
};

const processInput = async (message: string, _conversation: string[]) =>
  message;

const main = async () => {
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
