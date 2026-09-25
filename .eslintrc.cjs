/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    // es2022 (not es6): BigInt/globalThis are real globals in every runtime we ship to.
    es2022: true,
  },
  ignorePatterns: [
    "!**/.server", "!**/.client",
    // Snippets pasted into the Bankr skill's own page (its `$`/`bankr`/`load` globals), not our runtime.
    "bankr-skill/app-scripts/**",
  ],

  // Base config
  extends: ["eslint:recommended"],
  rules: {
    // `_x` = unused on purpose; `const { a, b, ...rest } = obj` drops a/b by design (exec's trade logger).
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
    // Block-level function declarations are standard since ES2015 (strict modules); the rule predates that.
    "no-inner-declarations": "off",
  },

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      rules: {
        // Props are typed by TypeScript; runtime PropTypes would be a second, drifting copy.
        "react/prop-types": "off",
      },
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
      rules: {
        // The TS-aware rule replaces the base one in TS files (the base one double-reports type imports).
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      },
    },

    // Cloudflare Workers + tools: not React. The hooks rule only knows "starts with use"
    // (lab-api's useEnvSecrets is a plain helper); Node/worker globals are real here.
    {
      files: ["workers/**/*.{js,mjs}", "tools/**/*.{js,mjs}"],
      env: { node: true, worker: true },
      rules: { "react-hooks/rules-of-hooks": "off" },
    },

    // Node
    {
      files: [".eslintrc.cjs"],
      env: {
        node: true,
      },
    },
  ],
};
