// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { AstPath, Options, Doc } from 'prettier';
import { doc } from 'prettier';
import type { EjsRootNode, EjsTagNode, EjsChildNode, EjsPluginOptions, FormatTagOptions } from './types.js';

const { hardline } = doc.builders;

const INDENT_UNIT = '  ';

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

/** Returns `true` when `s` contains only whitespace characters (or is empty). */
function isWhitespaceOnly(s: string): boolean {
  return /^\s*$/.test(s);
}

/**
 * Returns `true` when the tag uses both whitespace-slurping delimiters
 * (`<%_` … `_%>`).  These are the tags whose indentation is managed by the
 * printer's brace-depth tracking logic.
 */
function isSlurpingTag(tag: EjsTagNode): boolean {
  return tag.open === '<%_' && tag.close === '_%>';
}

/**
 * Split the raw content of an EJS tag into individual non-empty trimmed lines.
 */
function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Returns `true` when the (trimmed) line opens a new block. */
function endsWithOpenBrace(line: string): boolean {
  return line.trimEnd().endsWith('{');
}

/** Returns `true` when the (trimmed) line closes a block. */
function startsWithCloseBrace(line: string): boolean {
  return line.trimStart().startsWith('}');
}

/**
 * Format a single EJS tag into its final string representation.
 *
 * Rules:
 *   1. Content is trimmed (leading/trailing whitespace removed).
 *   2. Multiline content is collapsed to a single line when
 *      `options.collapseMultiline` is `true`.
 *   3. Exactly one space is placed before and after the content.
 *   4. `<%=` is converted to `<%-` when `options.preferRaw` is `true`.
 */
export function formatTag(
  open: string,
  rawContent: string,
  close: string,
  options: FormatTagOptions,
): string {
  const content = options.collapseMultiline
    ? splitLines(rawContent).join(' ')
    : rawContent.trim();

  // Convert <%=  to <%- when preferred.
  const formattedOpen = options.preferRaw && open === '<%=' ? '<%-' : open;

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

  const ejsOpts = options as Options & EjsPluginOptions;
  const preferRaw = shouldPreferRaw(ejsOpts.ejsPreferRaw, ejsOpts.filepath);
  const collapseMultiline = ejsOpts.ejsCollapseMultiline ?? true;
  const tagOptions: FormatTagOptions = { preferRaw, collapseMultiline };
  // Pre-built options for single-line tag formatting (used inside the
  // multiline-split loop where content is already a single trimmed line).
  const singleLineOptions: FormatTagOptions = { preferRaw, collapseMultiline: false };

  const children: EjsChildNode[] = node.children;
  const parts: string[] = [];
  let braceDepth = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.type === 'content') {
      const next = children[i + 1];
      // Pure-whitespace content immediately before a slurping tag is replaced
      // by the printer's own indentation logic – skip it here.
      if (next && next.type !== 'content' && isSlurpingTag(next as EjsTagNode) && isWhitespaceOnly(child.value)) {
        continue;
      }
      parts.push(child.value);
    } else {
      const tag = child as EjsTagNode;
      const prev = children[i - 1];
      // A tag is "standalone" when nothing (or only whitespace) precedes it
      // on the same line, meaning the printer controls its indentation.
      const isStandalone =
        !prev || (prev.type === 'content' && isWhitespaceOnly(prev.value));

      if (tag.type === 'comment_directive') {
        // Comment tags are emitted verbatim – no trimming, collapsing, or
        // brace-depth adjustment.
        parts.push(tag.open + tag.content + tag.close);
      } else if (isStandalone && isSlurpingTag(tag)) {
        // Whether the skipped preceding content contained a newline (so we
        // know whether to emit a `\n` before each tag).
        const prevHadNewline = !prev || prev.value.includes('\n');

        const lines = collapseMultiline
          ? splitLines(tag.content)
          : [tag.content.trim()].filter((l) => l.length > 0);

        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];

          if (startsWithCloseBrace(line)) {
            braceDepth = Math.max(0, braceDepth - 1);
          }

          const indent = INDENT_UNIT.repeat(braceDepth);

          if (j === 0) {
            // For the first line of this tag: emit a leading newline only when
            // the preceding (skipped) content had one.  Never emit a newline at
            // the very start of the output.
            if (prevHadNewline && parts.length > 0) {
              parts.push('\n');
            }
          } else {
            // Subsequent lines (split from multiline content) always get a
            // fresh line.
            parts.push('\n');
          }

          if (indent) {
            parts.push(indent);
          }

          parts.push(formatTag(tag.open, line, tag.close, singleLineOptions));

          if (endsWithOpenBrace(line)) {
            braceDepth++;
          }
        }
      } else {
        // Inline tag (preceded by non-whitespace) or non-slurping tag.
        // Still track brace depth so that a later standalone block is
        // indented correctly.
        const line = collapseMultiline
          ? splitLines(tag.content).join(' ')
          : tag.content.trim();

        if (startsWithCloseBrace(line)) {
          braceDepth = Math.max(0, braceDepth - 1);
        }

        parts.push(formatTag(tag.open, tag.content, tag.close, tagOptions));

        if (endsWithOpenBrace(line)) {
          braceDepth++;
        }
      }
    }
  }

  // Ensure a single trailing newline.
  const text = parts.join('').replace(/\n+$/, '');
  return [text, hardline];
}
