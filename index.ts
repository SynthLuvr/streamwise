import { input } from "@inquirer/prompts";
import { tools } from "./tools";

const main = async () => {
  console.debug("Loaded", tools.length, "tools");
  const userInput = await input({ message: "Ask anything" });
  console.log(userInput);
};

main();
