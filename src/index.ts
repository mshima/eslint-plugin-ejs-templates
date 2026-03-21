// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { processor } from './processor.js';
import { preferRaw } from './rules/prefer-raw.js';
import { preferSlurping } from './rules/prefer-slurping.js';
import { noMultilineTags } from './rules/no-multiline-tags.js';
import { ejsIndent } from './rules/ejs-indent.js';
import { Config } from 'eslint/config';

// ---------------------------------------------------------------------------
// Plugin definition (without configs, to avoid circular reference)
// ---------------------------------------------------------------------------

const pluginName = 'templates';

const pluginCore = {
  meta: {
    name: 'eslint-plugin-templates',
    version: '0.0.1',
  },
  processors: {
    ejs: processor,
  },
  rules: {
    'prefer-raw': preferRaw,
    'prefer-slurping': preferSlurping,
    'no-multiline-tags': noMultilineTags,
    'ejs-indent': ejsIndent,
  },
};

// ---------------------------------------------------------------------------
// Built-in flat configs
// ---------------------------------------------------------------------------

/**
 * Recommended config: applies the EJS processor to all `*.ejs` files.
 * No rules are enabled by default – opt in to individual rules as needed.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import templates from 'eslint-plugin-templates';
 * export default [
 *   ...templates.configs.recommended,
 * ];
 * ```
 */
const recommended: Config[] = [
  {
    files: ['**/*.ejs'],
    plugins: { [pluginName]: pluginCore },
    processor: `${pluginName}/ejs`,
  },
] as const satisfies Config[];

/**
 * All config: applies the EJS processor to all `*.ejs` files and enables
 * every plugin rule as `'error'`.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import templates from 'eslint-plugin-templates';
 * export default [
 *   ...templates.configs.all,
 * ];
 * ```
 */
const all: Config[] = [
  {
    files: ['**/*.ejs'],
    plugins: { [pluginName]: pluginCore },
    processor: `${pluginName}/ejs`,
    rules: {
      [`${pluginName}/prefer-raw`]: 'error',
      [`${pluginName}/prefer-slurping`]: 'error',
      [`${pluginName}/no-multiline-tags`]: 'error',
      [`${pluginName}/ejs-indent`]: 'error',
    },
  },
] as const satisfies Config[];

// ---------------------------------------------------------------------------
// Final plugin export
// ---------------------------------------------------------------------------

const plugin = {
  ...pluginCore,
  configs: { recommended, all },
};

export default plugin;
export { processor };
export { preferRaw, preferSlurping, noMultilineTags, ejsIndent };
