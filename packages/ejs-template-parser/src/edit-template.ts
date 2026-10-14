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
import { buildTemplate, cleanupTemplate, diagnoseTemplate, type EjsTemplate } from './template.js';

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
  /**
   * The ranges of the template written again, in order, each with what is written in its place: the template edited is
   * the template with them replaced. What they write again around the edits is written as it was, or as it renders.
   */
  replacements: EjsReplacement[];
  /**
   * The errors of the template edited (`diagnoseTemplate`) the edits bring, the template's own, at their offsets,
   * aside: diagnosed when read, once.
   */
  errors: EjsDiagnostic[];
};

/** A range of a template, and the text written in its place. */
export type EjsReplacement = { offset: number; length: number; text: string };

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
// No edit found reaches it: the close delimiter of a literal an edit is next to is written again, %%>, before the text.
/* v8 ignore next -- @preserve */
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

/** What editTemplate reads of a template: its texts and its tags, in order, where its characters are, its tokens. */
type Prepared = {
  texts: Text[];
  tags: Tag[];
  /** The tag at each offset where one starts, and the tag of each offset where one ends. */
  tagAt: Map<number, Tag>;
  tagEndingAt: Map<number, Tag>;
  /** Whether each character of the template is in a text, and whether it renders. */
  inText: Uint8Array;
  renders: Uint8Array;
  tokens: Range[];
};

/** The template built already, read once for the edits of every call. */
const preparedTemplates = new WeakMap<EjsTemplate, Prepared>();

const prepare = (built: EjsTemplate): Prepared => {
  const texts = built.nodes.flatMap((node) =>
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
  const tags = built.tags.map(({ offset, length, openDelim, closeDelim }) => ({
    offset,
    length,
    openDelim,
    closeDelim,
  }));
  const inText = new Uint8Array(built.text.length);
  const renders = new Uint8Array(built.text.length);
  for (const text of texts) {
    inText.fill(1, text.offset, text.offset + text.length);
    for (const renderedOffset of text.renderedOffsets.slice(0, -1)) renders[renderedOffset] = 1;
  }
  return {
    texts,
    tags,
    tagAt: new Map(tags.map((tag) => [tag.offset, tag])),
    tagEndingAt: new Map(tags.map((tag) => [tag.offset + tag.length, tag])),
    inText,
    renders,
    tokens: tokenRanges(texts),
  };
};

/** The index of the first item of a list in order for which a test, false then true along it, is true. */
const firstIndex = <Item>(items: readonly Item[], test: (item: Item) => boolean): number => {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (test(items[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
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
 *   it, but where the text of the edit starts with a tag opening `<%_`, or ends with a tag closing as the deleted one
 *   did, which slurps and drops them again: they stay; the blanks next to what is written again, which a delimiter
 *   could slurp once joined, are written again with what EJS rendered of them, and the blanks a delimiter kept slurps
 *   stay slurped.
 *
 * Where escapeText cannot write a text (a tag needed in the literal mode, see escapeText), its delimiters are escaped
 * alone: the errors tell what EJS would not render.
 *
 * @param template the template, which parses, or the template buildTemplate built of it, left as it is: built and
 *   read once for the edits of several calls, each one costing what it writes again
 * @param edits the edits, in offsets of the template
 * @returns the template edited, where each offset of the template is in it, the ranges written again, and the errors
 *   the edits bring
 * @throws RangeError when an edit is out of the template, overlaps another one, or cuts a tag
 * @throws EjsSyntaxError when the template does not parse
 */
export function editTemplate(template: string | EjsTemplate, edits: EjsEdit[]): EjsEditedTemplate {
  const source = typeof template === 'string' ? template : template.text;
  const sorted: SortedEdit[] = edits
    .map((edit, order) => ({ ...edit, order }))
    .sort((a, b) => a.offset - b.offset || a.order - b.order);

  // A template built already is left as it is, to its builder to free, and read once for the edits of every call.
  let prepared: Prepared;
  if (typeof template === 'string') {
    const built = buildTemplate(template);
    try {
      prepared = prepare(built);
    } finally {
      cleanupTemplate(built);
    }
  } else {
    prepared = preparedTemplates.get(template) ?? prepare(template);
    preparedTemplates.set(template, prepared);
  }
  const { texts, tags, tagAt, tagEndingAt, inText, renders, tokens } = prepared;
  /** The tag an offset is inside of, after its start and before its end. */
  const tagAround = (offset: number): Tag | undefined => {
    const tag = tags[firstIndex(tags, (candidate) => candidate.offset >= offset) - 1] as Tag | undefined;
    return tag && offset < tag.offset + tag.length ? tag : undefined;
  };

  let previousEnd = 0;
  for (const { offset, length } of sorted) {
    const end = offset + length;
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || end > source.length) {
      throw new RangeError(`The edit at ${String(offset)} of length ${String(length)} is out of the template`);
    }
    if (offset < previousEnd) throw new RangeError(`The edit at ${String(offset)} overlaps the one before it`);
    const cut = tagAround(offset) ?? tagAround(end);
    if (cut) throw new RangeError(`The edit at ${String(offset)} cuts the tag at ${String(cut.offset)}`);
    previousEnd = end;
  }

  // A tag an edit deletes, the text of the edit starting with a tag opening as it does, or ending with a tag closing as
  // it does: that tag slurps the blanks before it, or drops what follows it, as the deleted one did, which are left
  // where they are rather than deleted with it.
  const keptBefore = new Set<number>();
  const keptAfter = new Set<number>();
  for (const { offset, length, text = [] } of sorted) {
    const [first] = text;
    const last = text.at(-1);
    const startingTag = tagAt.get(offset);
    const opening = startingTag && startingTag.offset + startingTag.length <= offset + length ? startingTag : undefined;
    if (opening?.openDelim === '<%_' && typeof first === 'object' && first.tag.startsWith('<%_')) {
      keptBefore.add(opening.offset);
    }
    const endingTag = tagEndingAt.get(offset + length);
    const closing = endingTag && endingTag.offset >= offset ? endingTag : undefined;
    if (closing && closing.closeDelim !== '%>' && typeof last === 'object' && last.tag.endsWith(closing.closeDelim)) {
      keptAfter.add(closing.offset);
    }
  }

  /** The range written again for an edit: its own, grown until what is around it renders as before. */
  const regionOf = ({ start, end }: Range): Range => {
    for (;;) {
      const before = { start, end };
      // The tags of the range, then the tokens meeting it: found in their order, a pass repeated until it grows no more.
      for (let index = firstIndex(tags, (tag) => tag.offset >= start); index < tags.length; index++) {
        const tag = tags[index];
        // A region cuts no tag: a tag starting in it ends in it.
        if (tag.offset >= end) break;
        const tagEnd = tag.offset + tag.length;
        // A tag deleted, with the blanks it slurped and the line break it dropped, but the ones a tag of the edit
        // slurps and drops again.
        if (tag.openDelim === '<%_' && !keptBefore.has(tag.offset)) {
          let blanks = tag.offset;
          while (blanks > 0 && inText[blanks - 1] === 1 && isBlank(source[blanks - 1])) blanks--;
          start = Math.min(start, blanks);
        }
        if (tag.closeDelim !== '%>' && !keptAfter.has(tag.offset)) {
          let after = tagEnd;
          if (tag.closeDelim === '_%>') while (inText[after] === 1 && isBlank(source[after])) after++;
          const lineBreak = inText[after] === 1 ? LINE_BREAK.exec(source.slice(after)) : null;
          end = Math.max(end, after + (lineBreak?.[0].length ?? 0));
        }
      }
      for (let index = firstIndex(tokens, (token) => token.end > start); index < tokens.length; index++) {
        const token = tokens[index];
        if (token.start >= end) break;
        start = Math.min(start, token.start);
        end = Math.max(end, token.end);
      }
      // What could make a delimiter with what is written again, and the whitespace a delimiter could slurp or drop.
      const grows = (index: number) =>
        inText[index] === 1 &&
        (DELIMITER_CHARACTERS.has(source[index]) || (renders[index] === 1 && isWhitespace(source[index])));
      while (start > 0 && grows(start - 1)) start--;
      while (end < source.length && grows(end)) end++;
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
  let edited = source;
  let shift = 0;
  const replacements: EjsReplacement[] = [];
  let previousRegionEnd = 0;
  for (const region of regions) {
    const shiftBefore = shift;
    // The part of the template EJS reads the region in as in the whole of it, which is written again there: from the
    // start of the tag before the region, whose opening delimiter sets how EJS reads what follows, whatever comes
    // before it, to the start of the second tag after the region, the line break the first one drops included. From
    // the start of the template when that tag is in a region before, written again already.
    const beforeIndex = firstIndex(tags, (tag) => tag.offset + tag.length > region.start) - 1;
    const before = beforeIndex >= 0 ? tags[beforeIndex] : undefined;
    const windowStart = before && before.offset >= previousRegionEnd ? before.offset : 0;
    const after = firstIndex(tags, (tag) => tag.offset >= region.end) + 1;
    const windowEnd = after < tags.length ? tags[after].offset : source.length;
    const editedStart = windowStart === 0 ? 0 : windowStart + shift;
    const editedEnd = windowEnd + shift;
    previousRegionEnd = region.end;
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
      // The texts meeting the range, and their characters rendered from there.
      for (let at = firstIndex(texts, (text) => text.offset + text.length > from); at < texts.length; at++) {
        const text = texts[at];
        if (text.offset >= to) break;
        const offsets = text.renderedOffsets;
        for (let index = firstIndex(offsets, (offset) => offset >= from); index < offsets.length - 1; index++) {
          const renderedOffset = offsets[index];
          if (renderedOffset >= to) break;
          const deleted = region.edits.some(
            ({ offset, length }) => offset <= renderedOffset && renderedOffset < offset + length,
          );
          if (!deleted) characters += text.rendered[index];
        }
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
    let current = edited.slice(editedStart, region.start + shift) + edited.slice(region.end + shift, editedEnd);
    let at = region.start + shift - editedStart;
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
        /* v8 ignore start -- @preserve */
        if (!(error instanceof RangeError)) throw error;
        text = escapeDelimiters(slot.text);
        /* v8 ignore stop -- @preserve */
      }
      current = current.slice(0, slot.at) + text + current.slice(slot.at);
      written.set(slot, text.length);
    }
    let writtenBefore = 0;
    for (const slot of slots) {
      if (slot.mark !== undefined) moved.set(slot.mark, editedStart + slot.at + writtenBefore);
      writtenBefore += written.get(slot) ?? 0;
    }
    edited = edited.slice(0, editedStart) + current + edited.slice(editedEnd);
    shift = edited.length - source.length;
    replacements.push({
      offset: region.start,
      length: region.end - region.start,
      text: edited.slice(region.start + shiftBefore, region.end + shift),
    });
  }

  // An offset of a region at the mark of the bound before it, plus its distance to it, short of the next one; an
  // offset out of the regions shifted by what the regions before it changed. Computed when read, once.
  let offsets: number[] | undefined;
  const offsetsOf = (): number[] => (offsets ??= offsetsOfRegions());
  const offsetsOfRegions = (): number[] => {
    const offsets: number[] = [];
    let region = 0;
    let delta = 0;
    for (let offset = 0; offset <= source.length; offset++) {
      while (region < regions.length && regions[region].end < offset) {
        // The end of a region is one of its bounds, which have a mark.
        /* v8 ignore next -- @preserve */
        delta = (moved.get(regions[region].end) ?? 0) - regions[region].end;
        region++;
      }
      const current = regions.at(region);
      if (current && offset >= current.start) {
        const bound = Math.max(...[...moved.keys()].filter((key) => key >= current.start && key <= offset));
        const nextBound = Math.min(...[...moved.keys()].filter((key) => key > offset && key <= current.end));
        // The bounds are keys of `moved`.
        /* v8 ignore next -- @preserve */
        const at = (moved.get(bound) ?? 0) + (offset - bound);
        /* v8 ignore next -- @preserve */
        offsets.push(Number.isFinite(nextBound) ? Math.min(at, moved.get(nextBound) ?? at) : at);
      } else {
        offsets.push(offset + delta);
      }
    }
    return offsets;
  };

  // The errors, when they are read: they diagnose the template edited, and the template.
  let errors: EjsDiagnostic[] | undefined;
  return {
    template: edited,
    get offsets() {
      return offsetsOf();
    },
    replacements,
    get errors() {
      if (!errors) {
        const errorsOf = (text: string) => diagnoseTemplate(text).filter(({ severity }) => severity === 'error');
        const own = new Set(errorsOf(source).map(({ code, offset }) => `${code}@${String(offsetsOf()[offset])}`));
        errors = errorsOf(edited).filter(({ code, offset }) => !own.has(`${code}@${String(offset)}`));
      }
      return errors;
    },
  };
}
