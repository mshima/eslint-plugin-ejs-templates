// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { AstPath, Options, Doc } from 'prettier';
import { doc } from 'prettier';
import type { EjsRootNode, EjsPluginOptions } from './types.js';

const { hardline } = doc.builders;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether `<%=` should be converted to `<%-` for this file,
 * given the plugin option and the file path.
 */
function shouldPreferRaw(
  option: EjsPluginOptions['ejsPreferRaw'],
  filepath: string | undefined,
): boolean {
  switch (option) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'auto':
    default:
      // Prefer raw output for every file that is NOT a .html.ejs file.
      return !(typeof filepath === 'string' && filepath.endsWith('.html.ejs'));
  }
}

/**
 * Collapse and trim the content of a single EJS tag.
 *
 * - Leading/trailing whitespace on each line is removed.
 * - Empty/blank lines are ignored.
 * - Non-empty lines are joined with a single space.
 */
function collapseContent(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

/**
 * Format a single EJS tag into its final string representation.
 *
 * Rules:
 *   1. Content is trimmed (leading/trailing whitespace removed).
 *   2. Multiline content is collapsed to a single line when `collapseMultiline`
 *      is `true`.
 *   3. Exactly one space is placed before and after the content.
 *   4. `<%=` is converted to `<%-` when `preferRaw` is `true`.
 */
export function formatTag(
  open: string,
  rawContent: string,
  close: string,
  preferRaw: boolean,
  collapseMultiline: boolean,
): string {
  const content = collapseMultiline ? collapseContent(rawContent) : rawContent.trim();

  // Convert <%=  to <%- when preferred.
  const formattedOpen = preferRaw && open === '<%=' ? '<%-' : open;

  if (content === '') {
    return `${formattedOpen} ${close}`;
  }

  return `${formattedOpen} ${content} ${close}`;
}

// ---------------------------------------------------------------------------
// Prettier printer
// ---------------------------------------------------------------------------

/**
 * Print the EJS root AST node into a Prettier Doc.
 *
 * The printer is called by Prettier for the `'ejs-ast'` format.
 */
export function print(path: AstPath, options: Options): Doc {
  const node = path.getValue() as EjsRootNode;

  if (node.type !== 'root') {
    return '';
  }

  const ejsOptions = options as Options & EjsPluginOptions;
  const preferRaw = shouldPreferRaw(ejsOptions.ejsPreferRaw, ejsOptions.filepath);
  const collapseMultiline = ejsOptions.ejsCollapseMultiline ?? true;

  const parts: string[] = [];

  for (const child of node.children) {
    if (child.type === 'content') {
      parts.push(child.value);
    } else {
      parts.push(formatTag(child.open, child.content, child.close, preferRaw, collapseMultiline));
    }
  }

  // Ensure a single trailing newline.
  const text = parts.join('').replace(/\n+$/, '');
  return [text, hardline];
}
