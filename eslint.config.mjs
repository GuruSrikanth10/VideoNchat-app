import js from "@eslint/js";
import globals from "globals";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import prettier from "eslint-config-prettier/flat";

export default [
  { ignores: ["node_modules/", "coverage/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
  },
  {
    // Browser code (ES modules): remote data must never reach innerHTML.
    files: ["public/**/*.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.browser } },
    plugins: { "no-unsanitized": noUnsanitized },
    rules: {
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
    },
  },
  {
    files: ["test/e2e/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
];
