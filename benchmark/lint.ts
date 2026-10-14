// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

// The time eslint-plugin-ejs-templates takes to lint a directory of templates, without and with fixes, for builds of
// the repository: `base` and `head`, the base and the head of a pull request. The time of `head` must stay under
// `--max-ratio` times the one of `base`.
//
//   node benchmark/lint.ts --templates <dir> [--rounds 3] [--max-ratio 1.2] base=<checkout> head=<checkout>
//
// Each checkout is built (`npm run build`): its plugin is loaded from its `dist`, with the parser it resolves there.
// The builds are linted in turn, round after round, and the fastest round of each is kept, which the noise of a
// machine only slows down.

import { appendFileSync, globSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { ESLint, type Linter } from 'eslint';
import type pluginOfSources from '../packages/eslint-plugin-ejs-templates/src/index.ts';

type Plugin = typeof pluginOfSources;

/** Whether a module is the plugin's, its configurations to customize. */
const isPluginModule = (module: unknown): module is { default: Plugin } => {
  const plugin: unknown = typeof module === 'object' && module !== null ? Reflect.get(module, 'default') : undefined;
  const configs: unknown = typeof plugin === 'object' && plugin !== null ? Reflect.get(plugin, 'configs') : undefined;
  return typeof configs === 'object' && configs !== null && typeof Reflect.get(configs, 'customize') === 'function';
};

const { values, positionals } = parseArgs({
  options: {
    templates: { type: 'string' },
    rounds: { type: 'string', default: '3' },
    'max-ratio': { type: 'string', default: '1.2' },
  },
  allowPositionals: true,
});
const rounds = Number(values.rounds);
const maxRatio = Number(values['max-ratio']);
const named = positionals.map((positional) => positional.split('='));
if (values.templates === undefined || named.length === 0 || named.some(([name, checkout]) => !name || !checkout)) {
  throw new Error('Usage: node benchmark/lint.ts --templates <dir> [--rounds 3] [--max-ratio 1.2] <name>=<checkout>…');
}
// Absolute, as ESLint wants its cwd.
const templates = resolve(values.templates);
const builds = named.map(([name = '', checkout = '']) => ({ name, checkout: resolve(checkout) }));

const files = globSync('**/*.ejs', { cwd: templates })
  .sort()
  .map((file) => ({ filePath: resolve(templates, file), text: readFileSync(resolve(templates, file), 'utf8') }));

/** A configuration like generator-jhipster's, the rules of the plugin with JavaScript and stylistic ones. */
const configOf = (plugin: Plugin): Linter.Config[] =>
  plugin.configs.customize(
    {
      html: 'never',
      prettierBlocklist: true,
      stylisticBlocklist: true,
      experimental: true,
      allowedGlobals: ['wrapMono', 'generateEntityClientEnumImports', 'getOriginalField', 'generateFakeData'],
    },
    js.configs.recommended,
    stylistic.configs.customize({ jsx: false, semi: true }),
    {
      rules: {
        'dot-notation': 'error',
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-else-return': 'error',
        'no-negated-condition': 'error',
        'no-nested-ternary': 'error',
        'no-useless-concat': 'error',
        'no-useless-return': 'error',
        'no-var': 'error',
        'object-shorthand': 'error',
        'prefer-const': 'error',
        'prefer-template': 'error',
        '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'never' }],
        '@stylistic/comma-dangle': ['error', 'always-multiline'],
        '@stylistic/no-mixed-operators': 'off',
      },
    },
  );

/**
 * The templates whose fixes ESLint finds circular, rules fixing what others fixed until it gives up, by build: told
 * once in the summary rather than by a warning at each lint. ESLint takes `process.emitWarning` when it is created.
 */
const circular = new Map(builds.map(({ name }) => [name, new Set<string>()]));
let linting: { build: string; file: string } | undefined;
const emitWarning: unknown = Reflect.get(process, 'emitWarning');
Reflect.set(process, 'emitWarning', (warning: string | Error, ...rest: unknown[]) => {
  if (rest[0] === 'ESLintCircularFixesWarning' && linting) {
    circular.get(linting.build)?.add(linting.file);
  } else if (typeof emitWarning === 'function') {
    Reflect.apply(emitWarning, process, [warning, ...rest]);
  }
});

const linters = await Promise.all(
  builds.map(async ({ name, checkout }) => {
    const entry = pathToFileURL(resolve(checkout, 'packages/eslint-plugin-ejs-templates/dist/index.js')).href;
    const module: unknown = await import(entry);
    if (!isPluginModule(module)) throw new Error(`${entry} is not the plugin`);
    const plugin = module.default;
    const eslintOf = (fix: boolean) =>
      new ESLint({ cwd: templates, overrideConfigFile: true, overrideConfig: configOf(plugin), fix });
    return { name, lint: eslintOf(false), fix: eslintOf(true) };
  }),
);

/** The milliseconds an ESLint of a build takes to lint every template. */
const timeOf = async (build: string, eslint: ESLint): Promise<number> => {
  const started = performance.now();
  for (const { filePath, text } of files) {
    linting = { build, file: relative(templates, filePath) };
    await eslint.lintText(text, { filePath });
  }
  linting = undefined;
  return performance.now() - started;
};

const fastest = new Map(linters.map(({ name }) => [name, { lint: Infinity, fix: Infinity }]));
for (let round = 0; round < rounds; round++) {
  // Each build first in turn, so that neither is the one the machine warms up for.
  const order = round % 2 === 0 ? linters : linters.toReversed();
  for (const { name, lint, fix } of order) {
    const times = fastest.get(name);
    if (!times) continue;
    times.lint = Math.min(times.lint, await timeOf(name, lint));
    times.fix = Math.min(times.fix, await timeOf(name, fix));
  }
}

const ms = (time: number) => `${Math.round(time).toLocaleString('en-US')} ms`;
const [base] = linters;
const baseTimes = fastest.get(base.name);
const lines = [
  `### Lint of ${String(files.length)} templates, the fastest of ${String(rounds)} rounds`,
  '',
  `| Build | Lint | Lint with fixes |`,
  `| --- | --- | --- |`,
];
const ratios: number[] = [];
for (const [name, times] of fastest) {
  const ratio = (kind: 'lint' | 'fix') => {
    if (!baseTimes || name === base.name) return '';
    const value = times[kind] / baseTimes[kind];
    ratios.push(value);
    return ` (×${value.toFixed(2)})`;
  };
  lines.push(`| ${name} | ${ms(times.lint)}${ratio('lint')} | ${ms(times.fix)}${ratio('fix')} |`);
}
lines.push('', `The builds after \`${base.name}\` must stay under ×${String(maxRatio)} its time.`);
for (const [name, files] of circular) {
  if (files.size === 0) continue;
  lines.push(
    '',
    `Circular fixes with \`${name}\`, rules fixing what others fixed until ESLint gives up, in ${String(files.size)} template${files.size === 1 ? '' : 's'}:`,
    '',
    ...[...files].sort().map((file) => `- \`${file}\``),
  );
}
const summary = lines.join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (ratios.some((ratio) => ratio > maxRatio)) {
  console.error(`A build takes more than ×${String(maxRatio)} the time of ${base.name}.`);
  process.exitCode = 1;
}
