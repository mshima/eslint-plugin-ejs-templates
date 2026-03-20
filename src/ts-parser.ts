// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { createRequire } from 'module';
import { Parser, Language } from 'web-tree-sitter';
import type { Node as SyntaxNode } from 'web-tree-sitter';

export type { SyntaxNode };

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// One-time async initialisation (top-level await — valid in ES modules).
// By the time any caller imports this module the parser is ready to use.
// ---------------------------------------------------------------------------

await Parser.init({
  locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
});

const _language = await Language.load(
  require.resolve('tree-sitter-embedded-template/tree-sitter-embedded_template.wasm'),
);

const _parser = new Parser();
_parser.setLanguage(_language);

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
export function parseEjs(text: string): SyntaxNode {
  const tree = _parser.parse(text);
  if (!tree) throw new Error('tree-sitter failed to parse EJS template');
  return tree.rootNode;
}
