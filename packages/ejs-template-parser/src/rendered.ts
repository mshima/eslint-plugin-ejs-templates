// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { EjsClosingDelimiter, EjsOpeningDelimiter } from './ejs-parser.js';

/** What EJS renders of a text of a template, and where each character of it comes from. */
export type EjsRenderedText = {
  /** What EJS renders of the text, given the tags around it. */
  rendered: string;
  /**
   * The offset in the template of each character of `rendered`, then one more, its end: where a text inserted renders
   * after `rendered`, and drops nothing more. After its last rendered character, and after the blanks a written `_%>`
   * slurps and the line break dropped after it, but before the blanks a `<%_` after it slurps; when nothing renders,
   * after what the tag before it slurps. A character written in place of an escape maps to the one it is written from (the `<` and the first `%` of `<%%`, the `%` and the `>` of `%%>`), the extra `%` to nothing.
   */
  renderedOffsets: number[];
};

const BLANK = /[ \t]/;
/** The tokens EJS reads in a text, in the order of its own regular expression. */
const TEXT_TOKENS = /<%%|%%>|%>|-%>|_%>/g;

/**
 * What EJS 6 renders of a text of a template, between the tag closing with `closeBefore` and the one opening with
 * `openAfter` (none at the start or the end of the template), as `Template.prototype.generateSource` and `scanLine`
 * of EJS compile it:
 * - the blanks before a `<%_` and after a `_%>` are slurped;
 * - after a `-%>` or a `_%>`, the first line break of the next output is dropped;
 * - `<%%` renders `<%` and `%%>` renders `%>`, each one entering a literal mode in which the next close delimiter of
 *   the text is written, and ends that mode;
 * - a close delimiter of the text outside of that mode (`%>`, `-%>`, `_%>`) is dropped, a `-%>` or a `_%>` dropping
 *   the line break after it too.
 *
 * A character written in place of an escape (the `%` of `<%%`) maps to the one it is written from, the extra `%` to
 * nothing.
 */
export function renderText(
  { offset, text }: { offset: number; text: string },
  closeBefore?: EjsClosingDelimiter,
  openAfter?: EjsOpeningDelimiter,
): EjsRenderedText {
  // The blanks slurped before tokenizing: `[ \t]*<%_` and `_%>[ \t]*`, of the tags around the text and of the text.
  const kept: boolean[] = Array.from({ length: text.length }, () => true);
  if (openAfter === '<%_') {
    for (let index = text.length - 1; index >= 0 && BLANK.test(text[index]); index--) kept[index] = false;
  }
  const slurpedFrom = [...text.matchAll(/_%>/g)].map((match) => match.index + 3);
  if (closeBefore === '_%>') slurpedFrom.unshift(0);
  for (const from of slurpedFrom) {
    for (let index = from; index < text.length && BLANK.test(text[index]); index++) kept[index] = false;
  }
  let source = '';
  /** The offset in the template of each character of source. */
  const positions: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (kept[index]) {
      source += text[index];
      positions.push(offset + index);
    }
  }

  let rendered = '';
  const renderedOffsets: number[] = [];
  /** The number of blanks of the text from an index of it. */
  const afterBlanks = (from: number): number => /^[ \t]*/.exec(text.slice(from))?.[0].length ?? 0;
  /**
   * After what the tag before the text slurps, then after the last rendered character and what it drops after it: a
   * text inserted there renders, and drops nothing more.
   */
  let end = offset + (closeBefore === '_%>' ? afterBlanks(0) : 0);
  // The line break dropped after a `-%>` or a `_%>`, by the next output; the tag before the text a first one.
  let truncate = closeBefore === '-%>' || closeBefore === '_%>';
  let truncateOfTag = truncate;
  let literal = false;
  const write = (from: number, to: number): void => {
    for (let index = from; index < to; index++) {
      rendered += source[index];
      renderedOffsets.push(positions[index]);
    }
    if (to > from) end = positions[to - 1] + 1;
  };
  // `_addOutput` of EJS.
  const addOutput = (from: number, to: number): void => {
    if (truncate) {
      const lineBreak = /^(?:\r\n|\r|\n)/.exec(source.slice(from, to));
      if (lineBreak) {
        from += lineBreak[0].length;
        if (truncateOfTag || rendered !== '') end = positions[from - 1] + 1;
      }
      truncate = false;
    }
    truncateOfTag = false;
    write(from, to);
  };

  let last = 0;
  for (const { 0: token, index } of source.matchAll(TEXT_TOKENS)) {
    if (index > last) addOutput(last, index);
    last = index + token.length;
    if (token === '<%%' || token === '%%>') {
      // `<%` or `%>`, the extra `%` dropped.
      const [first, second] = token === '<%%' ? [index, index + 1] : [index, index + 2];
      rendered += source[first] + source[second];
      renderedOffsets.push(positions[first], positions[second]);
      end = positions[index + 2] + 1;
      literal = true;
      continue;
    }
    if (literal) {
      addOutput(index, last);
      // After the blanks a written `_%>` slurps too: a text inserted before them would keep them.
      if (token === '_%>') end += afterBlanks(end - offset);
    }
    literal = false;
    truncate = token !== '%>';
    truncateOfTag = false;
  }
  if (source.length > last) addOutput(last, source.length);
  renderedOffsets.push(end);
  return { rendered, renderedOffsets };
}
