import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // no-undef is off in the Next preset, which assumes TypeScript is doing
    // this job. This is a JavaScript codebase, so nothing was: a component
    // referenced without its import built clean, linted clean, and threw only
    // when someone opened the page. Caught exactly that while moving the Move
    // label maps out of gm/turns/page.js.
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, React: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
