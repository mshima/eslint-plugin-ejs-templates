// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: disallow complex statements in EJS tags.
 *
 * Reports complex statement types that are commonly considered too advanced
 * for template code. By default, blocks common control statements and
 * declarations that increase logic complexity.
 *
 * The rule keeps template code focused on rendering and simple logic,
 * encouraging developers to move controller logic outside of templates.
 */
export const noComplexStatements: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow complex statements (try, while, switch, etc.) in EJS tags to keep templates simple',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#no-complex-statements',
    },
    messages: {
      forbiddenTry: 'Try statements are forbidden in templates. Handle errors in the controller.',
      forbiddenLabel: 'Labeled statements are not allowed. Avoid complex control flow in templates.',
      forbiddenWith: 'With statements are forbidden due to scope ambiguity.',
      forbiddenClass: 'Class declarations are not allowed. Keep logic outside of the template.',
      forbiddenFunction: 'Function declarations are not allowed. Keep logic outside of the template.',
      forbiddenWhile: 'While loops are not allowed. Use Array methods like for...of for simpler iterations.',
      forbiddenDoWhile: 'Do-while loops are not allowed. Use Array methods like for...of for simpler iterations.',
      forbiddenDebugger: 'Debugger statements must be removed before deploying templates.',
      forbiddenSwitch: 'Switch statements are too verbose for templates. Move conditional logic to the controller.',
      defaultComplex: "The syntax '{{ nodeType }}' is too complex for a template. Move this logic to a controller.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          disallow: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    message: { type: 'string' },
                  },
                  required: ['type'],
                  additionalProperties: false,
                },
              ],
            },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const DEFAULT_FORBIDDEN = [
      'TryStatement',
      'LabeledStatement',
      'WithStatement',
      'ClassDeclaration',
      'FunctionDeclaration',
      'WhileStatement',
      'DoWhileStatement',
      'DebuggerStatement',
      'SwitchStatement',
    ];

    const messageMap: Record<string, string> = {
      TryStatement: 'forbiddenTry',
      LabeledStatement: 'forbiddenLabel',
      WithStatement: 'forbiddenWith',
      ClassDeclaration: 'forbiddenClass',
      FunctionDeclaration: 'forbiddenFunction',
      WhileStatement: 'forbiddenWhile',
      DoWhileStatement: 'forbiddenDoWhile',
      DebuggerStatement: 'forbiddenDebugger',
      SwitchStatement: 'forbiddenSwitch',
    };

    const options =
      (context.options[0] as { disallow?: (string | { type: string; message?: string })[] } | undefined) ?? {};
    const optionsDisallow = options.disallow ?? DEFAULT_FORBIDDEN;

    // Build a map of disallowed types and their custom messages
    const forbiddenMap = new Map<string, string | undefined>();
    for (const item of optionsDisallow) {
      if (typeof item === 'string') {
        forbiddenMap.set(item, undefined);
      } else {
        forbiddenMap.set(item.type, item.message);
      }
    }

    // Create a proxy handler that intercepts any statement type
    const proxyHandler: Record<string, (node: Rule.Node) => void> = {};

    // Register all statement types that might be in the forbidden list
    const statementTypes = new Set<string>();
    for (const type of forbiddenMap.keys()) {
      statementTypes.add(type);
    }

    // Also register default statement types
    for (const type of DEFAULT_FORBIDDEN) {
      statementTypes.add(type);
    }

    for (const statementType of statementTypes) {
      proxyHandler[statementType] = (node: Rule.Node) => {
        if (!forbiddenMap.has(statementType)) {
          return;
        }

        const customMessage = forbiddenMap.get(statementType);

        if (customMessage) {
          context.report({
            node,
            message: customMessage,
          });
        } else {
          const messageId = messageMap[statementType] ?? 'defaultComplex';
          const data = messageId === 'defaultComplex' ? { nodeType: statementType } : undefined;
          context.report({
            node,
            messageId,
            data,
          });
        }
      };
    }

    return proxyHandler;
  },
};
