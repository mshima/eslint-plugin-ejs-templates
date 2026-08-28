// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: disallow block-bodied functions in EJS tags.
 *
 * Reports function declarations, function expressions, and arrow functions
 * when their body is a statement block (`{ ... }`).
 *
 * Arrow functions with concise expression bodies are allowed, e.g.
 * `items.filter(x => x.ok)` and `items.map(x => x.name)`.
 */
export const noFunctionBlock: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow function or arrow function statement blocks in EJS tags',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#no-function-block',
    },
    messages: {
      noFunctionBlock:
        'Function statement blocks are not allowed in EJS templates; prefer concise arrow expressions or move logic outside templates.',
    },
    schema: [],
  },

  create(context) {
    // Reported by location rather than by node: `body` is typed as a bare ESTree node, so
    // passing it as `node` would require asserting it to `Rule.Node`. Reporting the same
    // `loc` that `node` reporting would have used avoids the assertion without moving the
    // reported position.
    const reportIfBlockBody = (node: { body: { type: string; loc?: Rule.Node['loc'] } }) => {
      const { body } = node;
      if (body.type === 'BlockStatement' && body.loc) {
        context.report({ loc: body.loc, messageId: 'noFunctionBlock' });
      }
    };

    return {
      FunctionDeclaration(node) {
        reportIfBlockBody(node);
      },
      FunctionExpression(node) {
        reportIfBlockBody(node);
      },
      ArrowFunctionExpression(node) {
        reportIfBlockBody(node);
      },
    };
  },
};
