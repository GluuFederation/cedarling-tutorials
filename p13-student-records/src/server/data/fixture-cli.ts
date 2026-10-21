import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, prepareData } from "../config/environment.ts";
import {
  type FixtureCommand,
  fixtureCommands,
  SchoolDatabase,
} from "./database.ts";

process.umask(0o077);
try {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const command = args[0];
  if (args.length !== 1 || !fixtureCommands.some((value) => value === command))
    throw new Error(`Usage: fixture ${fixtureCommands.join(" | ")}`);
  const config = loadConfig();
  if (!existsSync(resolve(config.dataDir, "school.sqlite")))
    throw new Error("Start the application before changing fixtures");
  const database = new SchoolDatabase(prepareData(config), config.issuer);
  try {
    const change = database.changeFixture(command as FixtureCommand);
    console.info(
      `P13 fixture | ${change.target} | ${change.state} | version ${change.version}`,
    );
  } finally {
    database.close();
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Fixture change failed",
  );
  process.exitCode = 1;
}
