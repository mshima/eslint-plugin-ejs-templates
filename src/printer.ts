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
function shouldPreferRaw(option: EjsPluginOptions['ejsPreferRaw'], filepath: string | undefined): boolean {
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
 * Returns the whitespace-only portion of `s` that follows its last newline
 * (or the whole string when it contains no newline).  Returns an empty string
 * when that portion contains any non-whitespace characters.
 *
 * This is the indentation that sits on the same line as whatever follows `s`
 * in the template.  Used to align the close delimiter of a multiline tag with
 * its open delimiter when `ejsIndent` is off.
 */
function getLineIndent(s: string): string {
  const lastNl = s.lastIndexOf('\n');
  const linePrefix = lastNl === -1 ? s : s.slice(lastNl + 1);
  return isWhitespaceOnly(linePrefix) ? linePrefix : '';
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

/**
 * Counts the number of leading close braces in a string, ignoring any
 * intermittent white spaces or new lines.
 *
 * @param str The input string.
 * @returns The count of leading close braces.
 */
function countLeadingCloseBraces(str: string): number {
  // Regex explanation:
  // ^      - Matches the start of the string
  // [\\s}] - Matches a whitespace character (\\s) or a close brace (})
  // *      - Matches the preceding character set zero or more times
  const match = str.match(/^[\s}]*/);

  if (match?.[0]) {
    // The matched substring might contain whitespaces, so we remove them
    // before counting the remaining characters (which should only be '}')
    const bracesOnly = match[0].replace(/\s/g, '');
    return bracesOnly.length;
  }

  return 0;
}

function bracesDelta(line: string): number {
  const open = (line.match(/{/g) ?? []).length;
  const close = (line.match(/}/g) ?? []).length;
  return open - close;
}

/**
 * Format a single EJS tag into its final string representation.
 *
 * Rules:
 *   1. Content is trimmed **only** when the trimmed result is a single line
 *      (contains no `\n`).  Multiline content is preserved as-is, with
 *      trailing spaces/tabs stripped for idempotency and a trailing newline
 *      ensured so the close delimiter sits on its own line.
 *   2. Multiline content is collapsed to a single line when
 *      `options.collapseMultiline` is `true`.
 *   3. Exactly one space is placed before and after single-line content.
 *   4. `<%=` is converted to `<%-` when `options.preferRaw` is `true`.
 *   5. `<% … %>` is converted to `<%_ … _%>` when `options.preferSlurping`
 *      is `true`.
 *   6. When content is multiline and `options.collapseMultiline` is `false`,
 *      the close delimiter is placed on its own line preceded by
 *      `options.indent` (so it aligns with the open tag).
 */
export function formatTag(open: string, rawContent: string, close: string, options: FormatTagOptions): string {
  // Convert <%=  to <%- when preferred.
  let formattedOpen = options.preferRaw && open === '<%=' ? '<%-' : open;
  let formattedClose = close;

  // Convert <% … %> to <%_ … _%> when preferred.
  if (options.preferSlurping && formattedOpen === '<%' && close === '%>') {
    formattedOpen = '<%_';
    formattedClose = '_%>';
  }

  if (options.collapseMultiline) {
    const content = splitLines(rawContent).join(' ');
    if (content === '') {
      return `${formattedOpen} ${formattedClose}`;
    }
    return `${formattedOpen} ${content} ${formattedClose}`;
  }

  // Trim only when the result is single-line.
  const trimmed = rawContent.trim();
  if (!trimmed.includes('\n')) {
    // Single-line result: use the trimmed content with one space on each side.
    if (trimmed === '') {
      return `${formattedOpen} ${formattedClose}`;
    }
    return `${formattedOpen} ${trimmed} ${formattedClose}`;
  }

  // Multiline result: behaviour differs by close delimiter.
  if (formattedClose === '_%>') {
    // Slurping close: always place _%> on its own indented new line.
    // Strip trailing spaces/tabs (but not newlines) so a previous format pass's
    // indent prefix does not accumulate (ensures idempotency).
    let normalizedContent = rawContent.replace(/[^\S\n]+$/, '');
    if (!normalizedContent.endsWith('\n')) {
      normalizedContent += '\n';
    }
    const indent = options.indent ?? '';
    const sep = normalizedContent.startsWith(' ') || normalizedContent.startsWith('\n') ? '' : ' ';
    return `${formattedOpen}${sep}${normalizedContent}${indent}${formattedClose}`;
  } else {
    // Non-slurping close (%>, -%>, …): preserve the raw content without any
    // modification — do not strip trailing whitespace and do not reposition
    // the close delimiter onto a new line.
    const sep = rawContent.startsWith(' ') || rawContent.startsWith('\n') ? '' : ' ';
    return `${formattedOpen}${sep}${rawContent}${formattedClose}`;
  }
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
  const collapseMultiline = ejsOpts.ejsCollapseMultiline ?? false;
  const preferSlurping = ejsOpts.ejsPreferSlurping ?? false;
  const ejsIndent = ejsOpts.ejsIndent ?? false;
  const tagOptions: FormatTagOptions = { preferRaw, collapseMultiline, preferSlurping };
  // Pre-built options for single-line tag formatting (used inside the
  // multiline-split loop where content is already a single trimmed line).
  const singleLineOptions: FormatTagOptions = {
    preferRaw,
    collapseMultiline: false,
    preferSlurping,
  };

  const children: EjsChildNode[] = node.children;
  const parts: string[] = [];
  let braceDepth = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.type === 'content') {
      const next = children[i + 1];
      // When ejsIndent is active, pure-whitespace content immediately before
      // a slurping tag is replaced by the printer's own indentation logic –
      // skip it here.  When ejsIndent is off, preserve it as-is.
      if (
        ejsIndent &&
        next &&
        next.type !== 'content' &&
        isSlurpingTag(next as EjsTagNode) &&
        isWhitespaceOnly(child.value)
      ) {
        continue;
      }
      parts.push(child.value);
    } else {
      const tag = child as EjsTagNode;
      const prev = children[i - 1];
      // A tag is "standalone" when nothing (or only whitespace) precedes it
      // on the same line, meaning the printer controls its indentation.
      const isStandalone = !prev || (prev.type === 'content' && isWhitespaceOnly(prev.value));

      // When ejsIndent is off, the close delimiter of a multiline tag should
      // align with the open tag.  Compute the leading whitespace on the same
      // line as the open tag once here for reuse in all tag branches below.
      const prevLineIndent = !ejsIndent && prev && prev.type === 'content' ? getLineIndent(prev.value) : '';

      if (tag.type === 'comment_directive') {
        // Comment tags are emitted verbatim – no trimming, collapsing, or
        // brace-depth adjustment.
        parts.push(tag.open + tag.content + tag.close);
      } else {
        const oldBraceDepth = braceDepth;
        braceDepth = Math.max(0, braceDepth + bracesDelta(tag.content));
        const lowerBraceDepth = Math.min(oldBraceDepth - countLeadingCloseBraces(tag.content), braceDepth);

        if (isStandalone && isSlurpingTag(tag)) {
          // Whether the skipped preceding content contained a newline (so we
          // know whether to emit a `\n` before each tag).
          const prevHadNewline = !prev || prev.value.includes('\n');

          const lines = collapseMultiline ? splitLines(tag.content) : [tag.content].filter((l) => l.length > 0);

          for (let j = 0; j < lines.length; j++) {
            const line = lines[j];
            const indent = ejsIndent ? INDENT_UNIT.repeat(lowerBraceDepth) : '';

            if (j === 0) {
              // For the first line of this tag: emit a leading newline only when
              // ejsIndent is active (meaning the preceding whitespace was skipped)
              // AND the preceding content had a newline.  When ejsIndent is off,
              // the original content node was not skipped, so it already carries
              // the newline.  Never emit a newline at the very start of the output.
              if (ejsIndent && prevHadNewline && parts.length > 0) {
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

            parts.push(
              formatTag(tag.open, line, tag.close, {
                ...singleLineOptions,
                indent: ejsIndent ? indent : prevLineIndent,
              }),
            );
          }
        } else {
          // For standalone tags the printer owns the indentation level; for
          // inline tags (ejsIndent off) use the same-line prefix from the
          // preceding content node so the close delimiter aligns with the open tag.
          const tagIndent = ejsIndent && isStandalone ? INDENT_UNIT.repeat(lowerBraceDepth) : prevLineIndent;
          parts.push(formatTag(tag.open, tag.content, tag.close, { ...tagOptions, indent: tagIndent }));
        }
      }
    }
  }

  // Ensure a single trailing newline.
  const text = parts.join('').replace(/\n+$/, '');
  return [text, hardline];
}
