import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["vendor/node-forge/**", "extension/annotation-storage.js", "extension/background.js", "extension/consent.js", "extension/web-annotator.js", "pi-extension/server.mjs", "pi-extension/contracts.mjs", "scripts/prepare-dev-profile.mjs", "scripts/validate-release.mjs", "scripts/build-typescript.mjs", "scripts/develop.mjs", "scripts/source-archive.mjs", "scripts/browser-fixture.mjs", "scripts/capture-screenshots.mjs", "scripts/encode-demo-gif.mjs", "scripts/pi-rpc-client.mjs", "scripts/record-live-demo.mjs", "scripts/run-demo-browser.mjs", "scripts/run-zen-dev.mjs", "scripts/serve-demo.mjs", "scripts/verify-node-forge.mjs"] }, {
  files: ["**/*.ts", "**/*.mts"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: "./tsconfig.json",
      tsconfigRootDir: import.meta.dirname,
    },
  },
  linterOptions: {
    noInlineConfig: true,
    reportUnusedDisableDirectives: "error",
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-argument": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/ban-ts-comment": ["error", {
      "ts-check": false,
      "ts-expect-error": true,
      "ts-ignore": true,
      "ts-nocheck": true,
    }],
    "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    "@typescript-eslint/no-non-null-assertion": "error",
  },
});
