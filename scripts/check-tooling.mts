import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(root, "scripts", "check-tooling-"));
const invalidFile = join(directory, "invalid.ts");
const validFile = join(directory, "valid.ts");
const noCheckFile = join(directory, "no-check.ts");

try {
  await writeFile(validFile, `
export function parse(text: string): string | undefined {
  const value: unknown = JSON.parse(text);
  return typeof value === "string" ? value : undefined;
}
`);
  await writeFile(invalidFile, `
export function implicit(value) { return value; }
export let explicit: any;
export const assigned = JSON.parse("{}");
export function returned() { return JSON.parse("{}"); }
export function argument(value: string): string { return value; }
argument(JSON.parse("{}"));
JSON.parse("{}").member;
JSON.parse("{}")();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let disabled: any;
// @ts-ignore
export const ignored: string = 1;
// @ts-expect-error
export const expected: string = 1;
export const asserted = JSON.parse("{}") as string;
export const angleAsserted = <string>JSON.parse("{}");
export const doubled = JSON.parse("{}") as unknown as string;
export function nonNull(value: string | undefined): string { return value!; }
`);

  await writeFile(noCheckFile, "// @ts-nocheck\nexport const value: string = 1;\n");

  const configFile = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(configFile.error, undefined, "tsconfig must load");
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  assert.deepEqual(config.errors, [], "tsconfig must parse");
  assert.equal(config.options.strict, true, "typecheck must stay strict");
  assert.equal(config.options.noEmit, true, "typecheck must not emit");
  assert.ok(config.fileNames.includes(invalidFile), "tooling fixtures must be typechecked");
  const program = ts.createProgram(config.fileNames, config.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.ok(diagnostics.some((diagnostic) =>
    diagnostic.file?.fileName === invalidFile && diagnostic.code === 7006),
  "strict typechecking must reject implicit any");
  assert.equal(diagnostics.filter((diagnostic) => diagnostic.file?.fileName === validFile).length, 0,
    "narrowed unknown must typecheck");

  const results = await new ESLint({ cwd: root }).lintFiles([invalidFile, validFile, noCheckFile]);
  const invalid = results.find((result) => result.filePath === invalidFile);
  const valid = results.find((result) => result.filePath === validFile);
  assert.ok(invalid, "negative fixture must be linted");
  assert.ok(valid, "positive fixture must be linted");
  const noCheck = results.find((result) => result.filePath === noCheckFile);
  assert.ok(noCheck?.messages.some((message) => message.ruleId === "@typescript-eslint/ban-ts-comment"),
    "whole-file TypeScript suppression must be rejected");
  assert.equal(valid.errorCount + valid.warningCount, 0, "narrowed unknown must lint cleanly");
  for (const rule of [
    "no-explicit-any",
    "no-unsafe-assignment",
    "no-unsafe-argument",
    "no-unsafe-call",
    "no-unsafe-member-access",
    "no-unsafe-return",
    "ban-ts-comment",
    "consistent-type-assertions",
    "no-non-null-assertion",
  ]) {
    assert.ok(invalid.messages.some((message) => message.ruleId === `@typescript-eslint/${rule}`),
      `lint must reject ${rule}`);
  }
  assert.ok(invalid.messages.some((message) => message.message.includes("noInlineConfig")),
    "inline ESLint suppression must not be honored");
  assert.equal(invalid.messages.filter((message) =>
    message.ruleId === "@typescript-eslint/consistent-type-assertions").length, 4,
  "as, angle-bracket and double assertions must all be rejected");
  assert.equal(invalid.messages.filter((message) =>
    message.ruleId === "@typescript-eslint/ban-ts-comment").length, 2,
  "TypeScript suppression directives must be rejected");
  console.log("Tooling rejects implicit/explicit any, unsafe operations, suppressions and unchecked assertions.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
