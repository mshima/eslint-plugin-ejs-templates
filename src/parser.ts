// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { createRequire } from 'node:module';
import { Parser, Language } from 'web-tree-sitter';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { EjsRootNode, EjsChildNode, EjsTagNode, EjsDirectiveType } from './types.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Tree-sitter initialisation (cached promise)
// ---------------------------------------------------------------------------

let parserPromise: Promise<Parser> | null = null;

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      // Resolve the WASM file for the web-tree-sitter runtime itself.
      const runtimeWasm: string = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
      await Parser.init({
        locateFile: () => runtimeWasm,
      });

      // Resolve the language-specific WASM grammar file.
      const langWasm: string = require.resolve('tree-sitter-embedded-template/tree-sitter-embedded_template.wasm');
      const lang = await Language.load(langWasm);

      const parser = new Parser();
      parser.setLanguage(lang);
      return parser;
    })();
  }
  return parserPromise;
}

// ---------------------------------------------------------------------------
// Tree-sitter AST → EJS AST conversion
// ---------------------------------------------------------------------------

/** Node types that represent EJS directive tags. */
const DIRECTIVE_TYPES = new Set<string>(['directive', 'output_directive', 'comment_directive', 'graphql_directive']);

/**
 * Extract the opening delimiter, code content, and closing delimiter from a
 * tree-sitter directive node.
 */
function extractDelimiters(node: SyntaxNode): { open: string; content: string; close: string } {
  const children = node.children;

  // The first and last non-anonymous children are the delimiters; the middle
  // named child (code or comment) is the content.
  const open = children[0]?.text ?? '<%';
  const close = children[children.length - 1]?.text ?? '%>';

  const contentNode = node.namedChildren.find((c: SyntaxNode) => c.type === 'code' || c.type === 'comment');
  const content = contentNode?.text ?? '';

  return { open, close, content };
}

/**
 * Convert a tree-sitter root SyntaxNode into our internal EJS AST.
 *
 * @throws {SyntaxError} when the source contains a syntax error detected by
 *   tree-sitter (an `ERROR` node in the tree), or when a closing delimiter
 *   `%>` appears in content without a matching opening delimiter `<%`.
 */
function syntaxNodeToAst(root: SyntaxNode, originalText: string): EjsRootNode {
  const children: EjsChildNode[] = [];

  for (const node of root.children) {
    if (node.hasError) {
      throw new SyntaxError(
        `EJS syntax error at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}: unexpected token near "${node.text.slice(0, 20)}"`,
      );
    }

    if (node.type === 'content') {
      // Detect a bare `%>` in content that is not preceded by `%` (which
      // would make it part of the `%%>` EJS escape sequence).  Such a token
      // means a closing delimiter `%>` appeared without a matching `<%`.
      const unmatchedClose = /(?<!%)%>/.exec(node.text);
      if (unmatchedClose) {
        const before = node.text.slice(0, unmatchedClose.index);
        const newlines = (before.match(/\n/g) ?? []).length;
        const row = node.startPosition.row + newlines;
        // When the match is on the first line of the node, offset from the
        // node's own start column.  On subsequent lines the node starts at
        // column 0, so the column is simply the distance from the preceding
        // newline to the match position.
        const col =
          newlines === 0
            ? node.startPosition.column + unmatchedClose.index
            : unmatchedClose.index - before.lastIndexOf('\n') - 1;
        throw new SyntaxError(
          `EJS syntax error at line ${row + 1}, column ${col + 1}: unexpected closing delimiter "%>" without a matching opening delimiter`,
        );
      }

      children.push({
        type: 'content',
        value: node.text,
        start: node.startIndex,
        end: node.endIndex,
      });
    } else if (DIRECTIVE_TYPES.has(node.type)) {
      const { open, content, close } = extractDelimiters(node);
      children.push({
        type: node.type as EjsDirectiveType,
        open,
        content,
        close,
        start: node.startIndex,
        end: node.endIndex,
      } satisfies EjsTagNode);
    }
  }

  return {
    type: 'root',
    children,
    start: 0,
    end: originalText.length,
  };
}

// ---------------------------------------------------------------------------
// Public parse function
// ---------------------------------------------------------------------------

/**
 * Parse an EJS template into an AST using tree-sitter-embedded-template.
 *
 * The parse is validated by tree-sitter: if the source contains a syntax
 * error, a `SyntaxError` is thrown.
 */
export async function parse(text: string): Promise<EjsRootNode> {
  const parser = await getParser();
  const tree = parser.parse(text);
  if (!tree) {
    throw new SyntaxError('tree-sitter failed to parse the EJS template');
  }
  return syntaxNodeToAst(tree.rootNode, text);
}
