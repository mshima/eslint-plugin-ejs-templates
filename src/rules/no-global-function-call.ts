// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: disallow direct function calls inside EJS tags.
 *
 * Reports direct calls (`foo()`) found in the virtual JavaScript generated
 * from EJS tags. Method calls (`obj.foo()`) are ignored.
 *
 * `include()` is allowed by default because it is commonly used in EJS
 * templates for composition.
 */
export const noGlobalFunctionCall: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct function calls in EJS tags (except include by default)',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#no-global-function-call',
    },
    messages: {
      noGlobalFunctionCall: 'Function calls are not allowed in EJS tags.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const allowFromOptions =
      (context.options[0] as { allow?: string[] } | undefined)?.allow?.filter((name) => name.trim().length > 0) ?? [];
    const allowedCalls = new Set<string>(['include', ...allowFromOptions]);

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') {
          return;
        }
        if (allowedCalls.has(node.callee.name)) {
          return;
        }
        context.report({
          node,
          messageId: 'noGlobalFunctionCall',
        });
      },
    };
  },
};
