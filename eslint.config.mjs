import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],
    },
  },
);
