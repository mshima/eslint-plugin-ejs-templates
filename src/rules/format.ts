// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_FORMAT, SENTINEL_FORMAT_MULTILINE_CLOSE, getVirtualCodeMetadata } from '../processor.js';

export const format: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description:
        'Normalize EJS tag formatting by ensuring spacing around content and optionally moving multiline close tag to its own aligned line',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#format',
    },
    messages: {
      format: 'EJS tag formatting should use a space around content.',
      formatMultilineClose:
        'EJS multiline tag close delimiter should be on a new line aligned with the opening tag indentation.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          multilineClose: {
            enum: ['new-line', 'same-line'],
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const multilineClose =
      (context.options[0] as { multilineClose?: 'new-line' | 'same-line' } | undefined)?.multilineClose ?? 'new-line';

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        const tagComments = comments.filter((c) => c.type === 'Line' && c.value.trim().startsWith('@ejs-tag:'));
        const metadata = getVirtualCodeMetadata(sourceCode.text);
        const tagFormatState = metadata?.tagFormat;

        for (let i = 0; i < tagComments.length; i++) {
          const comment = tagComments[i];
          const state = tagFormatState?.[i];
          const needsFormat =
            multilineClose === 'new-line'
              ? state?.isFormattedMultilineClose === false
              : state?.isFormattedDefault === false;

          if (!needsFormat) {
            continue;
          }

          const { range = [0, 0] } = comment;
          context.report({
            loc: comment.loc ?? { line: 0, column: 0 },
            messageId: multilineClose === 'new-line' ? 'formatMultilineClose' : 'format',
            fix(fixer) {
              return fixer.replaceTextRange(
                [range[0], range[1]],
                multilineClose === 'new-line' ? SENTINEL_FORMAT_MULTILINE_CLOSE : SENTINEL_FORMAT,
              );
            },
          });
        }
      },
    };
  },
};
