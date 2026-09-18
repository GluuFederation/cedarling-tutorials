import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { parseEnv } from "node:util";

const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function encoded(value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Environment values must be non-empty strings");
  return JSON.stringify(value);
}

export function mergeProjectEnvironment(
  currentText,
  { managed, defaults = {} },
) {
  const lineEnding = currentText.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = /\r?\n$/.test(currentText);
  const lines = currentText ? currentText.split(/\r?\n/) : [];
  if (trailingNewline) lines.pop();

  const seen = new Set();
  const synchronizedKeys = [];
  const nextLines = lines.map((line) => {
    const name = line.match(assignment)?.[1];
    if (!name) return line;
    if (seen.has(name)) throw new Error(`Duplicate environment key: ${name}`);
    seen.add(name);
    if (!Object.hasOwn(managed, name)) return line;
    const replacement = `${name}=${encoded(managed[name])}`;
    if (replacement !== line) synchronizedKeys.push(name);
    return replacement;
  });

  for (const [name, value] of Object.entries({ ...defaults, ...managed })) {
    if (seen.has(name)) continue;
    nextLines.push(`${name}=${encoded(value)}`);
    seen.add(name);
    synchronizedKeys.push(name);
  }

  const text = nextLines.length
    ? `${nextLines.join(lineEnding)}${lineEnding}`
    : "";
  return {
    text,
    environment: text ? parseEnv(text) : {},
    synchronizedKeys,
  };
}

export function readProjectEnvironment(target) {
  const status = lstatSync(target, { throwIfNoEntry: false });
  if (
    status &&
    (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1)
  )
    throw new Error(`${target} must be a single-link regular file`);
  const text = status ? readFileSync(target, "utf8") : "";
  return {
    exists: Boolean(status),
    text,
    environment: text ? parseEnv(text) : {},
  };
}

export function writePrivateEnvironment(target, text) {
  const current = readProjectEnvironment(target);
  if (current.exists && current.text === text) {
    if (process.platform !== "win32") chmodSync(target, 0o600);
    return false;
  }

  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  if (process.platform !== "win32") chmodSync(target, 0o600);
  return true;
}
