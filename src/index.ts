// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Plugin, SupportOption } from 'prettier';
import { parse } from './parser.js';
import { print } from './printer.js';
import type { EjsRootNode, EjsPluginOptions } from './types.js';

// ---------------------------------------------------------------------------
// Plugin-specific options
// ---------------------------------------------------------------------------

const ejsOptions: Record<keyof EjsPluginOptions, SupportOption> = {
  ejsPreferRaw: {
    category: 'EJS',
    type: 'choice',
    default: 'never',
    description:
      'Prefer <%- (raw / unescaped output) over <%= (HTML-escaped output). ' +
      '"always" converts unconditionally, "never" disables conversion, ' +
      '"auto" converts for every file that is not a .html.ejs file.',
    choices: [
      { value: 'always', description: 'Always prefer <%-' },
      { value: 'never', description: 'Never convert <%=' },
      {
        value: 'auto',
        description: 'Auto-detect based on file extension (.html.ejs keeps <%=)',
      },
    ],
  },
  ejsCollapseMultiline: {
    category: 'EJS',
    type: 'boolean',
    default: false,
    description:
      'Split multiline EJS tags into separate single-line tags, one per non-empty line. ' +
      'When false, multiline tag content is only trimmed.',
  },
  ejsPreferSlurping: {
    category: 'EJS',
    type: 'boolean',
    default: false,
    description:
      'Convert plain <% … %> script tags to the whitespace-slurping form <%_ … _%>.',
  },
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: Plugin<EjsRootNode> = {
  languages: [
    {
      name: 'EJS',
      parsers: ['ejs'],
      extensions: ['.ejs'],
      vscodeLanguageIds: ['html'],
    },
  ],

  parsers: {
    ejs: {
      async parse(text: string) {
        return parse(text);
      },
      astFormat: 'ejs-ast',
      locStart(node) {
        return node.start;
      },
      locEnd(node) {
        return node.end;
      },
    },
  },

  printers: {
    'ejs-ast': {
      print,
    },
  },

  options: ejsOptions,
};

export default plugin;
export { parse, print };
