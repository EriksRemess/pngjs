import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

const nodeGlobals = {
  Buffer: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-var": "error",
    },
  },
  {
    files: ["test/*.js", "examples/*.js"],
    rules: {
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
];
