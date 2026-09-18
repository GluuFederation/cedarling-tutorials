import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, prepareData } from "./config.ts";
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
    console.info(
      JSON.stringify(database.changeFixture(command as FixtureCommand)),
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
