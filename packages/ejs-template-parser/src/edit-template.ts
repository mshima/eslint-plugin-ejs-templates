// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { EjsDiagnostic } from './diagnostics.js';
import type { EjsClosingDelimiter, EjsOpeningDelimiter } from './ejs-parser.js';
import { escapeText } from './escape-text.js';
import { buildTemplate, cleanupTemplate, diagnoseTemplate, validateTemplate } from './template.js';

/** An edit of a template: what a range of it renders deleted, a text rendered in its place. */
export type EjsEdit = {
  /** The offset in the template of the range, where the text renders. */
  offset: number;
  /** The length of the range: characters of texts, and tags whole; 0 to insert alone. */
  length: number;
  /** What renders in place of the range: texts rendered as written, the source of tags inserted as it is. */
  text?: (string | { tag: string })[];
};

/** A template editTemplate edited. */
export type EjsEditedTemplate = {
  /** The template edited. */
  template: string;
  /**
   * The offset in the template edited of each offset of the template, then of its end, after what an edit inserts
   * there. Between the offsets where edits start and end, an offset of what is written again is at its distance from
   * the one before it, short of the next one: exactly where the characters are written as they were.
   */
  offsets: number[];
  /** The errors of the template edited (`diagnoseTemplate`) the edits bring: the template's own, at their offsets, aside. */
  errors: EjsDiagnostic[];
};

type Range = { start: number; end: number };
type Tag = { offset: number; length: number; openDelim: EjsOpeningDelimiter; closeDelim: EjsClosingDelimiter };
type Text = { offset: number; length: number; text: string; rendered: string; renderedOffsets: number[] };
type SortedEdit = EjsEdit & { order: number };

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';
const isWhitespace = (char: string | undefined) => char !== undefined && /\s/u.test(char);
/** The characters of the delimiters: next to what is written again, they could make one with it. */
const DELIMITER_CHARACTERS = new Set(['<', '%', '>', '-', '_']);
/** The tokens EJS reads in a text, in the order of its own regular expression (see renderText). */
const TEXT_TOKENS = /<%%|%%>|%>|-%>|_%>/g;
const LINE_BREAK = /^(?:\r\n|\r|\n)/;

/** A text written as it is, its delimiters escaped: what is written where escapeText cannot write. */
const escapeDelimiters = (text: string) => text.replaceAll('<%', '<%%').replaceAll('%>', '%%>');

/**
 * The ranges of the texts EJS reads as a whole, a part of which deleted would change how it reads the rest: an escaped
 * delimiter (`<%%`, `%%>`) with the literal mode it enters, up to the close delimiter it writes and leaves the mode
 * with, or the end of the text; and a close delimiter EJS drops. A `-%>` or a `_%>`, written or dropped, goes with what
 * it drops after it: the blanks after a `_%>`, the line break right after them.
 */
const tokenRanges = (texts: Text[]): Range[] => {
  const ranges: Range[] = [];
  for (const { offset, text } of texts) {
    let literal: number | undefined;
    for (const match of text.matchAll(TEXT_TOKENS)) {
      const start = offset + match.index;
      if (match[0] === '<%%' || match[0] === '%%>') {
        literal ??= start;
      } else {
        let end = match.index + match[0].length;
        if (match[0] === '_%>') while (isBlank(text[end])) end++;
        if (match[0] !== '%>') end += LINE_BREAK.exec(text.slice(end))?.[0].length ?? 0;
        ranges.push({ start: literal ?? start, end: offset + end });
        literal = undefined;
      }
    }
    if (literal !== undefined) ranges.push({ start: literal, end: offset + text.length });
  }
  return ranges;
};

/**
 * Edits a template: each edit deletes what a range of the template renders and renders its text there, the rest of the
 * template rendering as before, as EJS 6 and 7 render it (the default delimiters). The edits, in offsets of the
 * template, never overlap nor cut a tag; at the same offset, they apply in their order.
 *
 * What an edit changes is written again with what renders around it, so that EJS renders it as the edit says:
 * - the texts are written as escapeText writes them, in the template around them, the tags as they are;
 * - an escaped delimiter (`<%%`, `%%>`) goes with the character it renders, its extra `%` included, and the close
 *   delimiter whose literal mode it ends is written `%%>`, as is a delimiter the deletion would make in a text;
 * - the blanks and the line break a deleted tag slurped (before a `<%_`, after a `_%>` or a `-%>`) are deleted with
 *   it; the blanks next to what is written again, which a delimiter could slurp once joined, are written again with
 *   what EJS rendered of them, and the blanks a delimiter kept slurps stay slurped.
 *
 * Where escapeText cannot write a text (a tag needed in the literal mode, see escapeText), its delimiters are escaped
 * alone: the errors tell what EJS would not render.
 *
 * @param template the template, which parses
 * @param edits the edits, in offsets of the template
 * @returns the template edited, where each offset of the template is in it, and the errors the edits bring
 * @throws RangeError when an edit is out of the template, overlaps another one, or cuts a tag
 * @throws EjsSyntaxError when the template does not parse
 */
export function editTemplate(template: string, edits: EjsEdit[]): EjsEditedTemplate {
  const sorted: SortedEdit[] = edits
    .map((edit, order) => ({ ...edit, order }))
    .sort((a, b) => a.offset - b.offset || a.order - b.order);

  const built = buildTemplate(template);
  let texts: Text[];
  let tags: Tag[];
  let ownErrors: EjsDiagnostic[];
  try {
    ownErrors = validateTemplate(built).filter(({ severity }) => severity === 'error');
    texts = built.nodes.flatMap((node) =>
      node.kind === 'text'
        ? [
            {
              offset: node.offset,
              length: node.length,
              text: node.text,
              rendered: node.rendered,
              renderedOffsets: node.renderedOffsets,
            },
          ]
        : [],
    );
    tags = built.tags.map(({ offset, length, openDelim, closeDelim }) => ({ offset, length, openDelim, closeDelim }));
  } finally {
    cleanupTemplate(built);
  }

  let previousEnd = 0;
  for (const { offset, length } of sorted) {
    const end = offset + length;
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || end > template.length) {
      throw new RangeError(`The edit at ${String(offset)} of length ${String(length)} is out of the template`);
    }
    if (offset < previousEnd) throw new RangeError(`The edit at ${String(offset)} overlaps the one before it`);
    const cut = tags.find(
      (tag) =>
        (tag.offset < offset && offset < tag.offset + tag.length) ||
        (tag.offset < end && end < tag.offset + tag.length),
    );
    if (cut) throw new RangeError(`The edit at ${String(offset)} cuts the tag at ${String(cut.offset)}`);
    previousEnd = end;
  }

  /** Whether each character of the template is in a text, and whether it renders. */
  const inText = Array.from({ length: template.length }, () => false);
  const renders = Array.from({ length: template.length }, () => false);
  for (const text of texts) {
    for (let index = text.offset; index < text.offset + text.length; index++) inText[index] = true;
    for (const renderedOffset of text.renderedOffsets.slice(0, -1)) renders[renderedOffset] = true;
  }
  const tokens = tokenRanges(texts);

  /** The range written again for an edit: its own, grown until what is around it renders as before. */
  const regionOf = ({ start, end }: Range): Range => {
    for (;;) {
      const before = { start, end };
      for (const tag of tags) {
        const tagEnd = tag.offset + tag.length;
        if (tag.offset < start || tagEnd > end) continue;
        // A tag deleted, with the blanks it slurped and the line break it dropped.
        if (tag.openDelim === '<%_') {
          let blanks = tag.offset;
          while (blanks > 0 && inText[blanks - 1] && isBlank(template[blanks - 1])) blanks--;
          start = Math.min(start, blanks);
        }
        if (tag.closeDelim !== '%>') {
          let after = tagEnd;
          if (tag.closeDelim === '_%>') while (inText[after] && isBlank(template[after])) after++;
          const lineBreak = inText[after] ? LINE_BREAK.exec(template.slice(after)) : null;
          end = Math.max(end, after + (lineBreak?.[0].length ?? 0));
        }
      }
      for (const token of tokens) {
        if (token.start < end && token.end > start) {
          start = Math.min(start, token.start);
          end = Math.max(end, token.end);
        }
      }
      // What could make a delimiter with what is written again, and the whitespace a delimiter could slurp or drop.
      const grows = (index: number) =>
        inText[index] &&
        (DELIMITER_CHARACTERS.has(template[index]) || (renders[index] && isWhitespace(template[index])));
      while (start > 0 && grows(start - 1)) start--;
      while (end < template.length && grows(end)) end++;
      if (start === before.start && end === before.end) return { start, end };
    }
  };

  // The regions written again: the range of each edit grown, merged with the ones it meets.
  const regions: (Range & { edits: SortedEdit[] })[] = [];
  for (const edit of sorted) {
    let region: Range & { edits: SortedEdit[] } = {
      ...regionOf({ start: edit.offset, end: edit.offset + edit.length }),
      edits: [edit],
    };
    for (let last = regions.at(-1); last && last.end >= region.start; last = regions.at(-1)) {
      regions.pop();
      region = {
        ...regionOf({ start: Math.min(last.start, region.start), end: Math.max(last.end, region.end) }),
        edits: [...last.edits, ...region.edits],
      };
    }
    regions.push(region);
  }

  /** The offset in the template edited of each offset of a region, after what an edit inserts there. */
  const moved = new Map<number, number>();
  let edited = template;
  let shift = 0;
  for (const region of regions) {
    // What the region renders, edited, cut where its edits start and end: the texts of the edits there, a mark for
    // each offset, then the characters of the texts of the region the edits keep, up to the next one.
    const bounds = [
      ...new Set([
        region.start,
        ...region.edits.flatMap(({ offset, length }) => [offset, offset + length]),
        region.end,
      ]),
    ].sort((a, b) => a - b);
    const kept = (from: number, to: number) => {
      let characters = '';
      for (const text of texts) {
        text.renderedOffsets.slice(0, -1).forEach((renderedOffset, index) => {
          if (renderedOffset < from || renderedOffset >= to) return;
          const deleted = region.edits.some(
            ({ offset, length }) => offset <= renderedOffset && renderedOffset < offset + length,
          );
          if (!deleted) characters += text.rendered[index];
        });
      }
      return characters;
    };
    type Slot = { at: number; text?: string; tag?: string; mark?: number };
    const slots: Slot[] = [];
    let pending = '';
    const flush = () => {
      slots.push({ at: 0, text: pending });
      pending = '';
    };
    let next = 0;
    bounds.forEach((bound, index) => {
      for (; next < region.edits.length && region.edits[next].offset === bound; next++) {
        for (const part of region.edits[next].text ?? []) {
          if (typeof part === 'string') {
            pending += part;
          } else {
            flush();
            slots.push({ at: 0, tag: part.tag });
          }
        }
      }
      flush();
      slots.push({ at: 0, mark: bound });
      if (index + 1 < bounds.length) pending += kept(bound, bounds[index + 1]);
    });

    // The tags first, as they are, then the texts between them, the last first, each one with what is around it.
    let current = edited.slice(0, region.start + shift) + edited.slice(region.end + shift);
    let at = region.start + shift;
    for (const slot of slots) {
      slot.at = at;
      if (slot.tag !== undefined) {
        current = current.slice(0, at) + slot.tag + current.slice(at);
        at += slot.tag.length;
      }
    }
    const written = new Map<Slot, number>();
    for (const slot of slots.toReversed()) {
      if (!slot.text) continue;
      let text: string;
      try {
        text = escapeText(current, slot.at, slot.text);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        text = escapeDelimiters(slot.text);
      }
      current = current.slice(0, slot.at) + text + current.slice(slot.at);
      written.set(slot, text.length);
    }
    let before = 0;
    for (const slot of slots) {
      if (slot.mark !== undefined) moved.set(slot.mark, slot.at + before);
      before += written.get(slot) ?? 0;
    }
    shift = current.length - template.length;
    edited = current;
  }

  // An offset of a region at the mark of the bound before it, plus its distance to it, short of the next one; an
  // offset out of the regions shifted by what the regions before it changed.
  const offsets: number[] = [];
  let region = 0;
  let delta = 0;
  for (let offset = 0; offset <= template.length; offset++) {
    while (region < regions.length && regions[region].end < offset) {
      delta = (moved.get(regions[region].end) ?? 0) - regions[region].end;
      region++;
    }
    const current = regions.at(region);
    if (current && offset >= current.start) {
      const bound = Math.max(...[...moved.keys()].filter((key) => key >= current.start && key <= offset));
      const nextBound = Math.min(...[...moved.keys()].filter((key) => key > offset && key <= current.end));
      const at = (moved.get(bound) ?? 0) + (offset - bound);
      offsets.push(Number.isFinite(nextBound) ? Math.min(at, moved.get(nextBound) ?? at) : at);
    } else {
      offsets.push(offset + delta);
    }
  }

  const own = new Set(ownErrors.map(({ code, offset }) => `${code}@${String(offsets[offset])}`));
  const errors = diagnoseTemplate(edited).filter(
    ({ severity, code, offset }) => severity === 'error' && !own.has(`${code}@${String(offset)}`),
  );
  return { template: edited, offsets, errors };
}
