// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tree, Node as SyntaxNode } from '../web-tree-sitter.js';

export type { SyntaxNode, Tree };

const moduleDir = dirname(fileURLToPath(import.meta.url));

// `require` does not exist in an ES module: Node refuses this module when it reaches a bare `require`, which only
// transpiling loaders (jiti, vitest) define.
const require = createRequire(import.meta.url);

function resolveWasm(localFileName: string): string {
  const localPath = resolve(moduleDir, '../wasm', localFileName);
  // The build copies the grammars there: one missing is a broken install.
  /* v8 ignore next -- @preserve */
  if (!existsSync(localPath)) throw new Error(`WASM file not found: ${localFileName} (tried ${localPath})`);
  return localPath;
}

const { Parser, Language } = await import('web-tree-sitter');

// ---------------------------------------------------------------------------
// One-time async initialisation (top-level await — valid in ES modules).
// By the time any caller imports this module the parser is ready to use.
// ---------------------------------------------------------------------------

await Parser.init({
  locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
});

const _language = await Language.load(resolveWasm('tree-sitter-embedded_template.wasm'));
const _javascriptLanguage = await Language.load(resolveWasm('tree-sitter-javascript.wasm'));

const _parser = new Parser();
_parser.setLanguage(_language);

const _javascriptParser = new Parser();
_javascriptParser.setLanguage(_javascriptLanguage);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an EJS template using tree-sitter-embedded-template.
 *
 * The call is synchronous — the WASM initialisation has already completed
 * when this module was first imported.  Returns the parse tree, which lives in
 * WASM memory: free it with `tree.delete()`.
 */
export function parseEjs(text: string): Tree {
  const tree = _parser.parse(text);
  // tree-sitter returns no tree only when parsing is cancelled, which nothing here asks for.
  /* v8 ignore next -- @preserve */
  if (!tree) throw new Error('tree-sitter failed to parse EJS template');
  return tree;
}

/**
 * Parse JavaScript source using tree-sitter-javascript.
 */
export function parseJavaScript(text: string): Tree {
  const tree = _javascriptParser.parse(text);
  // tree-sitter returns no tree only when parsing is cancelled, which nothing here asks for.
  /* v8 ignore next -- @preserve */
  if (!tree) throw new Error('tree-sitter failed to parse JavaScript source');
  return tree;
}

export function findErrorNode(node: SyntaxNode): SyntaxNode | null {
  if (node.isError || node.isMissing) return node;
  for (const child of node.children) {
    const errorNode = findErrorNode(child);
    if (errorNode) return errorNode;
  }
  return null;
}

/** The nodes of a tree with an error, not the ones inside another one. */
// The walk goes down the subtrees tree-sitter tells have an error alone: walking a whole tree in JavaScript marshals
// each of its nodes out of WASM.
export const errorNodes = (node: SyntaxNode): SyntaxNode[] =>
  node.isError || node.isMissing ? [node] : node.hasError ? node.children.flatMap(errorNodes) : [];
