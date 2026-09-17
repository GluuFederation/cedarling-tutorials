import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist/web",
    emptyOutDir: false,
    rolldownOptions: { output: { comments: { legal: true } } },
  },
  oxc: { jsx: { runtime: "automatic" } },
});
