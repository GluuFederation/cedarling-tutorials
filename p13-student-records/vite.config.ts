import { defineConfig } from "vite";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
