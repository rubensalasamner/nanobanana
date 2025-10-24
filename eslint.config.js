// eslint.config.js
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import html from "eslint-plugin-html";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier"; // optional but nice

export default [
  // ignores
  {
    ignores: ["node_modules/", "dist/", "build/", ".vercel/", "coverage/", "public/**/*.min.js"],
  },

  // JS (all)
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    plugins: { import: importPlugin },
    rules: {
      ...js.configs.recommended.rules,
      "import/order": ["error", { "newlines-between": "always" }],
      "import/no-unresolved": "error",
      "import/newline-after-import": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // Node/server
  { files: ["server.js", "api/**/*.js"], languageOptions: { globals: globals.node } },

  // Browser/client
  { files: ["public/**/*.js"], languageOptions: { globals: globals.browser } },

  // ✅ HTML — lint <script> blocks inside .html
  {
    files: ["**/*.html"],
    plugins: { html },              // <-- include the plugin
    languageOptions: { globals: globals.browser },
    // no `processor` key needed in v9
  },

  // (optional) turn off rules that conflict with Prettier
  eslintConfigPrettier,
];
