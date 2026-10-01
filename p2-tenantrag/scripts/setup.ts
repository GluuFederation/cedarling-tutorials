/** Prepare local configuration, then explicitly build and verify the live-provider corpus. */
import "./prepare.js";
import { loadConfig } from "../src/config/project-config.js";
import { loadProjectEnvironment } from "../src/config/environment.js";
import { setupProject } from "../src/rag/setup.js";

loadProjectEnvironment();
const { recordCount, selectedModel } = await setupProject(loadConfig());
console.log(`Verified five PDFs and built ${recordCount} vector records.`);
console.log(`OpenRouter smoke selected ${selectedModel}.`);
