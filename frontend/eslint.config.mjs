import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { secret: _s, ...rest } = obj` is how the code drops a field
      // from a copy, and a leading underscore marks a parameter or variable
      // kept on purpose (a callback's position, a caught error). Neither is a
      // forgotten variable.
      "@typescript-eslint/no-unused-vars": ["warn", {
        ignoreRestSiblings: true,
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  {
    // Plain Node scripts run with `node <file>.js` (start.sh runs migrate.js):
    // package.json has no "type": "module", so they are CommonJS and require()
    // is the only way they can load pg.
    files: ["*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
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
