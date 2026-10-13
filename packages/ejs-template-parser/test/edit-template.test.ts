// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import ejs from 'ejs';
import { describe, expect, test } from 'vitest';
import { buildTemplate, cleanupTemplate, editTemplate, type EjsEdit } from '../src/index.js';

/** The template edited, alone. */
const edit = (template: string, edits: EjsEdit[]) => editTemplate(template, edits).template;

describe('editTemplate', () => {
  test('deletes what a range renders', () => {
    expect(editTemplate('a b c\n', [{ offset: 2, length: 2 }])).toEqual({
      template: 'a c\n',
      offsets: [0, 1, 2, 2, 2, 3, 4],
      errors: [],
    });
  });

  test('writes a text as escapeText writes it, the source of a tag as it is', () => {
    expect(edit('a\n', [{ offset: 1, length: 0, text: [' <%= x %>'] }])).toBe('a <%%= x %%>\n');
    expect(edit('a\n', [{ offset: 0, length: 1, text: ['Hello ', { tag: '<%= name %>' }, '!'] }])).toBe(
      'Hello <%= name %>!\n',
    );
  });

  test('applies several edits, each offset after what is inserted there', () => {
    expect(
      editTemplate('a b\n', [
        { offset: 2, length: 1, text: ['y'] },
        { offset: 0, length: 1, text: ['x'] },
      ]),
    ).toEqual({ template: 'x y\n', offsets: [1, 1, 3, 3, 4], errors: [] });
  });

  describe('deleting keeps the rest rendering as before', () => {
    test('the escape of a character deleted goes with it', () => {
      // `<%%` renders `<%`: deleting its `<` and `%` deletes its extra `%` too.
      expect(edit('a <%% b\n', [{ offset: 2, length: 2 }])).toBe('a  b\n');
    });

    test('the close delimiter whose literal mode a deletion ends is written %%>', () => {
      // The template of jhipster-workbench: `a <%% b %> c\n` renders `a <% b %> c\n`, the file edited to `a b %> c\n`.
      expect(editTemplate('a <%% b %> c\n', [{ offset: 2, length: 4 }])).toEqual({
        template: 'a b %%> c\n',
        offsets: [0, 1, 2, 2, 2, 2, 2, 3, 4, 5, 6, 8, 9, 10],
        errors: [],
      });
    });

    test('a delimiter the deletion would make is written %%>', () => {
      expect(edit('%x%>\n', [{ offset: 1, length: 1 }])).toBe('%\n');
    });

    test('a tag on a line of its own, with the line break it drops', () => {
      expect(edit('a\n<%_ x(); _%>\nb\n', [{ offset: 2, length: 12 }])).toBe('a\nb\n');
    });

    test('a block, with the line break its tags drop', () => {
      expect(edit('<%_ if (x) { _%>\nA\n<%_ } _%>\nB\n', [{ offset: 0, length: 28 }])).toBe('B\n');
    });

    test('the blanks before a tag, which a <%_ after would slurp, written again', () => {
      expect(edit('a  <%# c -%>\n<%_ y(); _%>\nb\n', [{ offset: 3, length: 9 }])).toBe("a<%- '  ' %><%_ y(); _%>\nb\n");
    });

    test('the blanks a delimiter kept slurps stay slurped', () => {
      expect(edit('a  <%_ x(); _%>\nb\n', [{ offset: 0, length: 1 }])).toBe('  <%_ x(); _%>\nb\n');
    });

    test('the line break a kept -%> drops stays dropped', () => {
      expect(edit('<% a -%>\nX\nY\n', [{ offset: 9, length: 1 }])).toBe('<% a -%>\n\nY\n');
    });
  });

  test('gives the errors the edits bring, not the template its own', () => {
    // The template drops its own %> at 2; the edit inserts another one, as a tag.
    expect(editTemplate('x %> y\nz\n', [{ offset: 7, length: 1, text: [{ tag: '%>' }] }])).toEqual({
      template: 'x %> y\n%>\n',
      offsets: [0, 1, 2, 3, 4, 5, 6, 9, 9, 10],
      errors: [
        {
          code: 'stray-close-delimiter',
          severity: 'error',
          message: 'EJS drops this %> of the text: write %%> for a literal one',
          offset: 7,
          length: 2,
          line: 2,
          column: 0,
        },
      ],
    });
  });

  test.each([
    ['out of the template', [{ offset: 3, length: 2 }]],
    [
      'overlapping another edit',
      [
        { offset: 0, length: 2 },
        { offset: 1, length: 0 },
      ],
    ],
    ['cutting a tag', [{ offset: 0, length: 3 }]],
    ['in a tag', [{ offset: 1, length: 0 }]],
  ] as const)('refuses an edit %s', (_label, edits) => {
    expect(() => editTemplate('<% a %>', [...edits])).toThrow(RangeError);
  });

  describe('against EJS', () => {
    // Texts made of what EJS reads: the characters of its delimiters, blanks, line breaks, escaped delimiters.
    const units = ['<', '%', '>', '-', '_', ' ', '\n', 'a', '<%%', '%%>'];
    const textsOf = (count: number): string[] =>
      count === 0
        ? ['']
        : [
            ...new Set([
              ...textsOf(count - 1),
              ...textsOf(count - 1).flatMap((text) => units.map((unit) => text + unit)),
            ]),
          ];
    const tags = ['<%', '<%_', '<%=', '<%-', '<%#'].flatMap((open) =>
      ['%>', '-%>', '_%>'].map((close) => `${open} ${open === '<%=' || open === '<%-' ? "'' " : ''}${close}`),
    );
    // Each template with the texts inserted at its places, and the longest range of a text deleted: the shorter
    // templates with all of them; the longer ones with fewer texts, and ranges as long as an escaped delimiter.
    const inserted = ['', 'x', ' ', '\n', '<', '%', '>', '<%', '%>', '-%>', ' x '];
    const all = { texts: inserted, longest: Infinity };
    const some = { texts: ['', 'x', ' ', '\n', '<%', '%>'], longest: Infinity };
    const fewer = { texts: ['', 'x', '%>'], longest: 3 };
    const templates = new Map<string, { texts: string[]; longest: number }>();
    for (const text of textsOf(3)) templates.set(text, text.length <= 4 ? all : fewer);
    for (const before of textsOf(1)) {
      for (const tag of tags) {
        for (const after of textsOf(1)) templates.set(before + tag + after, some);
      }
    }
    // The literal mode and the close delimiters EJS drops, with text between them, which shorter texts lack.
    const literals = [
      'a <%% b %> c',
      'a <%% b -%>\nc',
      'a <%% b _%>  \nc',
      'a %%> b %> c',
      '<%% a %> b %> c',
      'a %> b <%% c %> d',
      'x <%%a%%>b%> y',
      'a -%>\n b _%> c',
      'a <%% b %>\r\nc',
      'a <%% b -%>\r\nc',
      'a _%>\t\nb',
      '\t<%% a %>',
      'x %>%> y',
      '<%%<%% a',
      'a %%>%%> b',
      'a\n  <%% b %>  \n',
    ];
    for (const literal of literals) {
      templates.set(literal, all);
      for (const tag of tags) {
        templates.set(literal + tag, fewer);
        templates.set(tag + literal, fewer);
      }
    }
    const renderOrFail = (template: string) => {
      try {
        return ejs.render(template);
      } catch {
        return undefined;
      }
    };

    test('renders the template with the edit applied to what it renders', { timeout: 120_000 }, () => {
      const failures: string[] = [];
      let checked = 0;
      for (const [template, { texts, longest }] of templates) {
        const rendered = renderOrFail(template);
        if (rendered === undefined) continue;
        const built = buildTemplate(template);
        // The tags of these templates render nothing: the texts render the template, each character from an offset.
        const from: number[] = [];
        const ranges: [number, number][] = [];
        try {
          for (const node of built.nodes) {
            if (node.kind === 'text') {
              from.push(...node.renderedOffsets.slice(0, -1));
              for (let start = node.offset; start <= node.offset + node.length; start++) {
                const last = Math.min(node.offset + node.length, start + longest);
                for (let end = start; end <= last; end++) ranges.push([start, end]);
              }
            } else {
              ranges.push([node.offset, node.offset + node.length]);
            }
          }
        } finally {
          cleanupTemplate(built);
        }
        for (const [start, end] of ranges) {
          for (const text of texts) {
            const name = `${JSON.stringify(template)} [${String(start)}, ${String(end)}) ${JSON.stringify(text)}`;
            let edited: string;
            try {
              edited = edit(template, [{ offset: start, length: end - start, text: [text] }]);
            } catch (error) {
              failures.push(`${name}: ${String(error)}`);
              continue;
            }
            const place = from.filter((offset) => offset < start).length;
            let kept = '';
            for (let index = 0; index < rendered.length; index++) {
              if (from[index] < start || from[index] >= end) kept += rendered[index];
            }
            const expected = kept.slice(0, place) + text + kept.slice(place);
            const actual = renderOrFail(edited);
            if (actual !== expected) failures.push(`${name} -> ${JSON.stringify(edited)}: ${JSON.stringify(actual)}`);
            checked++;
          }
        }
      }
      expect(failures.slice(0, 20)).toEqual([]);
      expect(checked).toBe(277_066);
    });

    test('renders the template with two edits applied to what it renders', { timeout: 120_000 }, () => {
      const failures: string[] = [];
      let checked = 0;
      for (const template of [
        ...textsOf(2),
        ...literals,
        ...tags.flatMap((tag) => textsOf(1).map((before) => `${before}${tag}a %> b`)),
      ]) {
        const rendered = renderOrFail(template);
        if (rendered === undefined) continue;
        const built = buildTemplate(template);
        const from: number[] = [];
        try {
          for (const node of built.nodes) if (node.kind === 'text') from.push(...node.renderedOffsets.slice(0, -1));
        } finally {
          cleanupTemplate(built);
        }
        // Two characters it renders, each one replaced by a text.
        for (let first = 0; first < from.length; first++) {
          for (let second = first + 1; second < from.length; second++) {
            if (from[first] === from[second]) continue;
            const edits: EjsEdit[] = [
              { offset: from[first], length: 1, text: ['x'] },
              { offset: from[second], length: 1, text: ['%>'] },
            ];
            const name = `${JSON.stringify(template)} ${JSON.stringify(edits)}`;
            let expected = '';
            for (let index = 0; index < rendered.length; index++) {
              expected += index === first ? 'x' : index === second ? '%>' : rendered[index];
            }
            let edited: string;
            try {
              edited = edit(template, edits);
            } catch (error) {
              failures.push(`${name}: ${String(error)}`);
              continue;
            }
            const actual = renderOrFail(edited);
            if (actual !== expected) failures.push(`${name} -> ${JSON.stringify(edited)}: ${JSON.stringify(actual)}`);
            checked++;
          }
        }
      }
      expect(failures.slice(0, 20)).toEqual([]);
      expect(checked).toBe(2_659);
    });
  });
});
