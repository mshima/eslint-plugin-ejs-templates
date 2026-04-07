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
import { format } from './rules/format.js';
import { noGlobalFunctionCall } from './rules/no-global-function-call.js';
import { noFunctionBlock } from './rules/no-function-block.js';
import { noCommentEmptyLine } from './rules/no-comment-empty-line.js';
import { preferEncoded } from './rules/prefer-encoded.js';
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
    format,
    'no-global-function-call': noGlobalFunctionCall,
    'no-function-block': noFunctionBlock,
    'no-comment-empty-line': noCommentEmptyLine,
    'prefer-encoded': preferEncoded,
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

const stylistIgnoredRules = {
  // Not compatible / not applicable
  // New line should be added to the EJS file itself, not virtual code.
  '@stylistic/eol-last': 'off',

  // Not recommended
  // Generates multi-line tags that are not easily readable.
  '@stylistic/multiline-ternary': 'off',
  // Default value of "stroustrup" is not ideal for EJS code blocks, it splits else in a multiline tag.
  '@stylistic/brace-style': 'off',

  // Interoperability issues
  '@stylistic/indent': 'off',
  // Semicolons are added to virtual code for linting purposes. Needs adjusts.
  '@stylistic/semi-spacing': 'off',
  // Semicolons are added to virtual code for linting purposes. Needs adjusts.
  '@stylistic/semi': 'off',
  // Semicolons are added to virtual code for linting purposes. Needs adjusts.
  '@stylistic/no-extra-semi': 'off',

  // Unknown
  // Block padding is controlled by ejs plugin.
  // '@stylistic/padded-blocks': 'off',
};

const preferEncodedRule = (encoded: boolean) => ({
  [`${pluginName}/prefer-encoded`]: encoded ? 'error' : 'off',
  [`${pluginName}/prefer-raw`]: encoded ? 'off' : 'error',
});

export const customizeEjs = (
  {
    allowedGlobals,
    experimental,
    html = 'extension',
    stylisticBlacklist = false,
    prettierBlacklist = false,
  }: {
    allowedGlobals?: string[];
    experimental?: boolean;
    html?: 'always' | 'never' | 'extension';
    stylisticBlacklist?: boolean;
    prettierBlacklist?: boolean;
  },
  ...configs: Config[]
): Config[] => {
  return [
    ...configs.map((c) => ({ ...c, files: ['**/*.ejs'] })),
    {
      ...base[0],
      rules: {
        [`${pluginName}/no-global-function-call`]: ['error', { allow: allowedGlobals ?? [] }],
        [`${pluginName}/no-function-block`]: 'error',
        [`${pluginName}/no-comment-empty-line`]: 'error',

        [`${pluginName}/prefer-single-line-tags`]: 'error',
        [`${pluginName}/slurp-newline`]: 'error',
        [`${pluginName}/prefer-slurping-codeonly`]: 'error',
        [`${pluginName}/experimental-prefer-slurp-multiline`]: experimental ? 'error' : 'off',
        [`${pluginName}/indent`]: ['error', experimental ? { normalizeContent: true } : {}],
        [`${pluginName}/format`]: 'error',
        ...(stylisticBlacklist ? stylistIgnoredRules : {}),
        ...(prettierBlacklist ? { 'prettier/prettier': 'off' } : {}),
      },
    },
    ...(html === 'extension'
      ? [
          {
            files: ['**/*.html.ejs'],
            rules: preferEncodedRule(true),
          },
          {
            files: ['**/*.ejs'],
            ignores: ['**/*.html.ejs'],
            rules: preferEncodedRule(false),
          },
        ]
      : [
          {
            files: ['**/*.ejs'],
            rules: preferEncodedRule(html === 'always'),
          },
        ]),
  ] as Config[];
};

// ---------------------------------------------------------------------------
// Final plugin export
// ---------------------------------------------------------------------------

const plugin = {
  ...pluginCore,
  configs: { base },
};

export default plugin;
export { processor };
export {
  preferRaw,
  preferSlurpingCodeonly,
  preferSlurpMultiline,
  preferSingleLineTags,
  slurpNewline,
  indent,
  format,
  noGlobalFunctionCall,
  noFunctionBlock,
  noCommentEmptyLine,
  preferEncoded,
};
