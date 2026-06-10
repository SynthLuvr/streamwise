import { input } from "@inquirer/prompts";
import { tools } from "./tools";

const getInput = async () => {
  try {
    return await input({ message: "Ask anything" });
  } catch {
    return false;
  }
};

const isExit = (message: string | false) => {
  if (message === false) return true;
  if (["quit", "exit", "q"].includes(message)) return true;
  return false;
};

const main = async () => {
  console.debug("Loaded", tools.length, "tools");

  while (true) {
    const userInput = await getInput();
    if (isExit(userInput)) return;
    console.log(userInput);
  }
};

main();
