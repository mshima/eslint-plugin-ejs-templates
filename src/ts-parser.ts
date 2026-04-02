// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser, Language } from 'web-tree-sitter';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';

export type { SyntaxNode };

const moduleDir = dirname(fileURLToPath(import.meta.url));

function resolveWasm(localFileName: string): string {
  const localPath = resolve(moduleDir, '../wasm', localFileName);
  if (existsSync(localPath)) {
    return localPath;
  }
  throw new Error(`WASM file not found: ${localFileName} (tried ${localPath})`);
}

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
 * when this module was first imported.  Returns the root {@link SyntaxNode}
 * of the parse tree.
 */
export function parseEjs(text: string): Tree {
  const tree = _parser.parse(text);
  if (!tree) throw new Error('tree-sitter failed to parse EJS template');
  return tree;
}

/**
 * Parse JavaScript source using tree-sitter-javascript.
 */
export function parseJavaScript(text: string): Tree {
  const tree = _javascriptParser.parse(text);
  if (!tree) throw new Error('tree-sitter failed to parse JavaScript source');
  return tree;
}
