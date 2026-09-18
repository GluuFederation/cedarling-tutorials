import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const typeCheckedFiles = ["src/**/*.ts", "test/**/*.ts"];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typeCheckedFiles,
  })),
  {
    ignores: ["dist/", "coverage/", "eslint.config.js", "scripts/"],
  },
  {
    files: typeCheckedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: { globals: { process: "readonly" } },
  },
);
