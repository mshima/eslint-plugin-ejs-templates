// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter } from 'eslint';

// ---------------------------------------------------------------------------
// EJS tag regex
// ---------------------------------------------------------------------------

/**
 * Matches a single EJS tag, capturing:
 *   group 1 – opening modifier: `-`, `_`, `=`, `#`, or empty string
 *   group 2 – tag content (JS code or comment text)
 *   group 3 – closing modifier: `-`, `_`, or `undefined`
 *
 * The negative lookahead `(?!%)` prevents matching EJS escaped delimiters
 * (`<%%>`) which should be rendered as literal `<%>` text, not parsed as tags.
 */
const EJS_RE = /<%(?!%)([-_=#]?)([\s\S]*?)([-_])?%>/g;

// ---------------------------------------------------------------------------
// Slurping eligibility check (mirrored from the former printer)
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a plain `<% … %>` tag can be safely promoted to
 * `<%_ … _%>`.  Conditions:
 *   - Balanced braces
 *   - Does not start with `}` (would close a preceding block)
 *   - Does not end with `{` (would open a block whose close lives elsewhere)
 */
export function canConvertToSlurping(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.startsWith('}') || trimmed.endsWith('{')) return false;
  const open = (trimmed.match(/{/g) ?? []).length;
  const close = (trimmed.match(/}/g) ?? []).length;
  return open === close;
}

// ---------------------------------------------------------------------------
// Tag-block extraction
// ---------------------------------------------------------------------------

/** A single extracted EJS tag together with its position in the original file. */
export interface TagBlock {
  /**
   * Virtual JS code for this block.
   * Line 1 is a single-line comment encoding the tag type (`//@ejs-tag:<type>`).
   * Lines 2+ are the raw JS code content of the tag.
   */
  virtualCode: string;
  /** 1-based line in the original EJS file where the opening delimiter starts. */
  tagLine: number;
  /** 0-based column in the original EJS file where the opening delimiter starts. */
  tagColumn: number;
  /** 1-based line in the original EJS file where the JS code content starts. */
  originalLine: number;
  /** 0-based column in the original EJS file where the JS code content starts. */
  originalColumn: number;
  /** Character offset of the tag start (`<`) in the original source. */
  tagOffset: number;
  /** Total length of the original tag (opening delimiter + content + closing delimiter). */
  tagLength: number;
  /** Determined tag type (same value as the `//@ejs-tag:<type>` marker). */
  tagType: string;
  /** Raw JS content captured between the delimiters (used for prefer-slurping fix). */
  codeContent: string;
}

/**
 * Build a look-up table mapping each character offset to `{line, column}`.
 * We precompute the start offset of every line in a single pass so that the
 * per-tag position queries are O(log n) binary-search rather than O(offset)
 * string-splitting.
 */
function buildLineStartOffsets(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Convert a character offset to a `{line (1-based), column (0-based)}` pair. */
function offsetToLineCol(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] };
}

/**
 * Extract each non-comment EJS tag from `text` as a {@link TagBlock}.
 *
 * The virtual code for each block is structured as:
 * ```
 * //@ejs-tag:<tagType>
 * <raw JS code from the tag>
 * ```
 *
 * Tag types:
 * - `escaped-output`  – `<%= … %>`
 * - `raw-output`      – `<%- … %>`
 * - `slurp`           – `<%_ … _%>` / `<% … _%>` / `<%_ … %>`
 * - `code`            – `<% … %>` that cannot be promoted to slurping
 * - `code-slurpable`  – `<% … %>` that can be safely promoted to `<%_ … _%>`
 */
export function extractTagBlocks(text: string): TagBlock[] {
  const blocks: TagBlock[] = [];
  const re = new RegExp(EJS_RE.source, 'g');
  // Build the line-start offset table once; reused for every tag position query.
  const lineStarts = buildLineStartOffsets(text);
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const openMod = match[1]; // -, _, =, #, or ''
    const code = match[2]; // raw JS / comment content
    const closeMod = match[3] ?? ''; // -, _, or ''

    // Skip comment tags entirely – they carry no lintable JS.
    if (openMod === '#') continue;

    // Determine the tag type for the virtual comment marker.
    let tagType: string;
    if (openMod === '=') {
      tagType = 'escaped-output';
    } else if (openMod === '-') {
      tagType = 'raw-output';
    } else if (openMod === '_' || closeMod === '_') {
      tagType = 'slurp';
    } else if (closeMod === '-') {
      // Trim-newline close: treat as plain code (no slurping suggestion).
      tagType = 'code';
    } else {
      // Plain `<% … %>`: check if it can be promoted to slurping.
      tagType = canConvertToSlurping(code) ? 'code-slurpable' : 'code';
    }

    // Position of the opening delimiter in the original file.
    const { line: tagLine, column: tagColumn } = offsetToLineCol(lineStarts, match.index);

    // Position of the JS code content (right after the opening delimiter).
    const openDelimLength = 2 + openMod.length; // `<%` = 2, `<%_` = 3, etc.
    const { line: originalLine, column: originalColumn } = offsetToLineCol(lineStarts, match.index + openDelimLength);

    // For `code` tags (structural openers/closers like `<% if (x) { %>` or
    // `<% } %>`, or tags with a trim-newline close `-%>`) and for `slurp` tags
    // whose content has unbalanced braces (e.g. `<%_ if (x) { _%>`), the raw
    // JS content is a syntactically incomplete fragment.  Including it verbatim
    // in the virtual JS program would cause ESLint parse errors.  Only tags
    // whose content is a syntactically self-contained statement are safe to
    // include, so that standard JS rules (no-undef, eqeqeq, …) can inspect them.
    const isIncomplete = tagType === 'code' || (tagType === 'slurp' && !canConvertToSlurping(code));
    const virtualCodeBody = isIncomplete ? '' : code;

    blocks.push({
      virtualCode: `//@ejs-tag:${tagType}\n${virtualCodeBody}`,
      tagLine,
      tagColumn,
      originalLine,
      originalColumn,
      tagOffset: match.index,
      tagLength: match[0].length,
      tagType,
      codeContent: code,
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Message position mapping
// ---------------------------------------------------------------------------

/**
 * Map an ESLint message from the virtual JS file back to the original EJS file.
 *
 * Virtual file structure:
 * ```
 * Line 1:  //@ejs-tag:<type>   ← type marker comment
 * Line 2:  <first line of JS>  ← block.originalLine  (col shifted by block.originalColumn)
 * Line 3:  <second line …>     ← block.originalLine + 1 (col unchanged)
 * …
 * ```
 *
 * Column mapping for the first JS line (virtual line 2):
 *   The JS code begins immediately after the opening delimiter (e.g., `<%=`).
 *   `block.originalColumn` is the 0-based column of the first code character,
 *   so `original_column = virtual_column + block.originalColumn`.
 *   Subsequent lines begin at column 0 in the original file (the JS content
 *   already carries its own indentation), so no column adjustment is needed.
 */
function mapMessage(msg: Linter.LintMessage, block: TagBlock): Linter.LintMessage {
  if (msg.line <= 1) {
    // Error on the type-comment line → report at the opening delimiter position.
    return { ...msg, line: block.tagLine, column: block.tagColumn };
  }

  // Lines 2+ correspond to actual JS code.
  const codeLineIndex = msg.line - 2; // 0-based
  const originalLine = block.originalLine + codeLineIndex;
  // Only the first code line (codeLineIndex === 0) needs a column offset,
  // because the code begins immediately after the opening delimiter on that line.
  const originalColumn = codeLineIndex === 0 ? msg.column + block.originalColumn : msg.column;

  const mapped: Linter.LintMessage = { ...msg, line: originalLine, column: originalColumn };

  if (msg.endLine !== undefined) {
    const endCodeLineIndex = msg.endLine - 2;
    mapped.endLine = block.originalLine + endCodeLineIndex;
    mapped.endColumn = endCodeLineIndex === 0 ? (msg.endColumn ?? 0) + block.originalColumn : msg.endColumn;
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// Fix translation
// ---------------------------------------------------------------------------

/**
 * Translate an ESLint fix object from the virtual JS code space back to the
 * original EJS source space.
 *
 * Our rules report fixes using sentinel ranges in the virtual code (the rule
 * has no way to know the original character offsets).  This function uses the
 * metadata stored in the {@link TagBlock} to produce a fix with the correct
 * range and replacement text for the original EJS file.
 *
 * Supported translations:
 * - `escaped-output` block → `prefer-raw` fix: replace `=` with `-` in `<%=`
 * - `code-slurpable` block → `prefer-slurping` fix: replace `<% … %>` with `<%_ … _%>`
 *
 * Returns `null` for tag types that have no registered fix translation.
 */
function translateFix(
  _fix: { range: [number, number]; text: string },
  block: TagBlock,
): { range: [number, number]; text: string } | null {
  if (block.tagType === 'escaped-output') {
    // Change `<%=` → `<%-`: replace the `=` (at offset 2 from tag start) with `-`.
    return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '-' };
  }

  if (block.tagType === 'code-slurpable') {
    // Change `<% code %>` → `<%_ code _%>`: replace the whole tag.
    return {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: `<%_${block.codeContent}_%>`,
    };
  }

  return null; // no fix translation for this tag type
}

/**
 * Per-file block metadata shared between `preprocess` and `postprocess`.
 * Keyed by the filename passed to the processor.
 */
const fileBlocksMap = new Map<string, TagBlock[]>();

/**
 * ESLint processor for `.ejs` files.
 *
 * Each non-comment EJS tag (`<% … %>`, `<%= … %>`, `<%- … %>`, `<%_ … _%>`)
 * is extracted into its own virtual JavaScript block.  The first line of every
 * block is a single-line comment (`//@ejs-tag:<type>`) that encodes the tag
 * type so that plugin rules can detect EJS-specific patterns.  The remaining
 * lines are the raw JS content of the tag, preserving their original line
 * structure so that `postprocess` can map ESLint messages back to the correct
 * positions in the source `.ejs` file.
 */
export const processor: Linter.Processor = {
  meta: { name: 'ejs' },

  preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
    const blocks = extractTagBlocks(text);
    fileBlocksMap.set(filename, blocks);
    return blocks.map((b) => b.virtualCode);
  },

  postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
    const blocks = fileBlocksMap.get(filename) ?? [];
    fileBlocksMap.delete(filename);

    return messages.flatMap((blockMessages, i) => {
      const block = blocks[i];
      if (!block) return blockMessages;
      return blockMessages.map((msg) => {
        const mapped = mapMessage(msg, block);

        // Translate fix objects from virtual code space to original source space.
        if (mapped.fix) {
          const translated = translateFix(mapped.fix, block);
          if (translated) {
            return { ...mapped, fix: translated };
          }
          // No translation available – drop the fix to avoid applying a
          // wrong range to the original source.
          const result = { ...mapped };
          delete result.fix;
          return result;
        }

        return mapped;
      });
    });
  },

  supportsAutofix: true,
};
