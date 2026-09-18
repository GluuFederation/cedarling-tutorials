import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";

const project = realpathSync(process.cwd());
const target = resolve(project, ".data");
if (target !== `${project}${sep}.data`)
  throw new Error("Refusing to reset an unexpected path");
if (existsSync(target)) {
  if (lstatSync(target).isSymbolicLink())
    throw new Error("Refusing to reset a symbolic link");
  const resolved = realpathSync(target);
  if (resolved !== target || !resolved.startsWith(`${project}${sep}`))
    throw new Error("Refusing to reset data outside the project");
  rmSync(target, { recursive: true });
}
console.log("P1 local data reset");
