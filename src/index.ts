// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { processor } from './processor.js';
import { preferRaw } from './rules/prefer-raw.js';
import { preferSlurpingCodeonly } from './rules/prefer-slurping-codeonly.js';
import { preferSlurpMultiline } from './rules/prefer-slurp-multiline.js';
import { preferSingleLineTags } from './rules/prefer-single-line-tags.js';
import { slurpNewline } from './rules/slurp-newline.js';
import { indent } from './rules/indent.js';
import { type Config } from 'eslint/config';

// ---------------------------------------------------------------------------
// Plugin definition (without configs, to avoid circular reference)
// ---------------------------------------------------------------------------

const pluginName = 'ejs-templates';

const pluginCore = {
  meta: {
    name: 'eslint-plugin-ejs-templates',
    version: '0.0.1',
  },
  processors: {
    ejs: processor,
  },
  rules: {
    'prefer-raw': preferRaw,
    'prefer-slurping-codeonly': preferSlurpingCodeonly,
    'experimental-prefer-slurp-multiline': preferSlurpMultiline,
    'prefer-single-line-tags': preferSingleLineTags,
    'slurp-newline': slurpNewline,
    indent,
  },
};

// ---------------------------------------------------------------------------
// Built-in flat configs
// ---------------------------------------------------------------------------

/**
 * Base config: applies the EJS processor to all `*.ejs` files.
 * No rules are enabled by default – opt in to individual rules as needed.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import templates from 'eslint-plugin-ejs-templates';
 * export default [
 *   ...templates.configs.base,
 * ];
 * ```
 */
const base: Config[] = [
  {
    files: ['**/*.ejs'],
    plugins: { [pluginName]: pluginCore },
    processor: `${pluginName}/ejs`,
  },
] as const satisfies Config[];

/**
 * All config: applies the EJS processor to all `*.ejs` files and enables
 * every plugin rule as `'error'`.  Rules are listed in recommended order.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import templates from 'eslint-plugin-ejs-templates';
 * export default [...templates.configs.all];
 * ```
 */
const all: Config[] = [
  {
    files: ['**/*.ejs'],
    plugins: { [pluginName]: pluginCore },
    processor: `${pluginName}/ejs`,
    rules: {
      [`${pluginName}/experimental-prefer-slurp-multiline`]: 'error',
      [`${pluginName}/prefer-slurping-codeonly`]: 'error',
      [`${pluginName}/prefer-single-line-tags`]: 'error',
      [`${pluginName}/slurp-newline`]: 'error',
      [`${pluginName}/indent`]: 'error',
      [`${pluginName}/prefer-raw`]: 'error',
    },
  },
] as const satisfies Config[];

// ---------------------------------------------------------------------------
// Final plugin export
// ---------------------------------------------------------------------------

const plugin = {
  ...pluginCore,
  configs: { base, all },
};

export default plugin;
export { processor };
export { preferRaw, preferSlurpingCodeonly, preferSlurpMultiline, preferSingleLineTags, slurpNewline, indent };
