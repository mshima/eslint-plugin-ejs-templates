// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { findErrorNode, parseEjs, type SyntaxNode, type Tree } from './ts-parser.js';

export type EjsSyntaxNode = SyntaxNode & { linePrefix: string };

export const EJS_OPENING_DELIMS = ['<%=', '<%-', '<%_', '<%#', '<%'] as const;
export const EJS_CLOSING_DELIMS = ['-%>', '_%>', '%>'] as const;
export type EjsOpeningDelimiter = (typeof EJS_OPENING_DELIMS)[number];
export type EjsClosingDelimiter = (typeof EJS_CLOSING_DELIMS)[number];

/**
 * Whether tree-sitter absorbed the `_` of a `_%>` close delimiter into this tag's code node.
 *
 * tree-sitter-embedded-template ends an output tag's code node one character too late when the
 * tag closes with `_%>`, leaving `%>` as the delimiter and a stray `_` at the end of the code
 * (tree-sitter/tree-sitter-embedded-template#46). Left uncorrected the `_` reaches the
 * JavaScript parser and makes the whole file fail to lint.
 */
export const hasAbsorbedSlurpClose = (node: SyntaxNode): boolean =>
  node.type === 'output_directive' &&
  node.text.endsWith('_%>') &&
  node.children[node.childCount - 1]?.text === '%>' &&
  (node.children[1]?.text.endsWith('_') ?? false);

/**
 * Code text of a directive tag, with an absorbed `_` close-delimiter marker removed.
 *
 * Every consumer of a tag's code must go through this: the virtual JavaScript and the tag
 * blocks are built from the same nodes, so correcting only one of them leaves the other
 * carrying the stray `_`.
 */
export const getDirectiveCodeText = (node: SyntaxNode): string => {
  const codeText = node.children[1]?.text ?? '';
  return hasAbsorbedSlurpClose(node) ? codeText.slice(0, -1) : codeText;
};

/**
 * Extract the close delimiter from an EJS comment tag text.
 * Supported delimiters: `%>`, `-%>`, `_%>`
 */
export function getCommentCloseDelimiter(commentText: string): EjsClosingDelimiter {
  for (const delim of EJS_CLOSING_DELIMS) {
    if (commentText.endsWith(delim)) {
      return delim;
    }
  }
  return '%>'; // fallback
}

/**
 * Parse an EJS template into its tree and the nodes of its top level, each one augmented with the
 * text before it on its line. The tree is freed and an error thrown when the template has syntax errors.
 */
export const parseEjsNodes = (text: string): { tree: Tree; nodes: EjsSyntaxNode[] } => {
  const tree = parseEjs(text);
  if (tree.rootNode.hasError) {
    const errorNode = findErrorNode(tree.rootNode);
    if (!errorNode) {
      tree.delete();
      throw new Error('Unexpectedly did not find error node in tree with hasError=true');
    }
    const error = Object.assign(
      new Error(
        `Failed to parse EJS template at line ${String(errorNode.startPosition.row + 1)}, column ${String(errorNode.startPosition.column + 1)}: unexpected token '${text.slice(errorNode.startIndex, errorNode.endIndex)}'`,
      ),
      { line: errorNode.startPosition.row + 1, column: errorNode.startPosition.column + 1 },
    );
    tree.delete();
    throw error;
  }

  return {
    tree,
    nodes: tree.rootNode.children.map((node) =>
      Object.assign(node, {
        linePrefix: text.slice(node.startIndex - node.startPosition.column, node.startIndex),
      }),
    ),
  };
};

/**
 * Parse an EJS template and extract syntax nodes for tag block extraction.
 *
 * Uses tree-sitter-embedded-template for accurate EJS parsing. If parsing fails,
 * throws a detailed error with line/column position and the offending token.
 *
 * Each returned node is augmented with a `linePrefix` property containing the
 * whitespace/indentation before the node on its line. This is used during
 * tag block extraction to preserve original indentation.
 *
 * The nodes keep their tree alive in WASM memory: free it with `nodes[0].tree.delete()`
 * once they are no longer used.
 *
 * @throws Error if the EJS template has syntax errors
 */
export const getEjsNodes = (text: string): EjsSyntaxNode[] => parseEjsNodes(text).nodes;
