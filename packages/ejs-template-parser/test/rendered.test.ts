// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import ejs from 'ejs';
import { describe, test, expect } from 'vitest';
import { type EjsTemplate, type EjsText, buildTemplate, cleanupTemplate } from '../src/template.js';

/** The texts of a template, built, its trees freed. */
function textsOf(text: string): EjsText[] {
  const template = buildTemplate(text);
  try {
    return template.nodes.filter((node) => node.kind === 'text');
  } finally {
    cleanupTemplate(template);
  }
}

/** What EJS renders of each text of a template, and the offsets of its characters. */
const renderedOf = (text: string) =>
  textsOf(text).map(({ rendered, renderedOffsets }) => ({ rendered, renderedOffsets }));

/** The template with its tags emptied, with the same delimiters: an output tag an empty code tag. */
const emptied = (template: EjsTemplate): string =>
  template.nodes
    .map((node) => {
      if (node.kind === 'text') return node.text;
      if (node.type === 'comment') return `<%# ${node.closeDelim}`;
      return `${node.openDelim === '<%_' ? '<%_' : '<%'} ${node.closeDelim}`;
    })
    .join('');

describe('rendered', () => {
  test('the blanks before a <%_ are slurped', () => {
    expect(renderedOf('a \t<%_ x _%>')).toEqual([{ rendered: 'a', renderedOffsets: [0, 1] }]);
  });

  test('the blanks after a _%> are slurped', () => {
    expect(renderedOf('<% x _%> \tb')).toEqual([{ rendered: 'b', renderedOffsets: [10, 11] }]);
  });

  test('a -%> drops the first line break of the next text', () => {
    expect(renderedOf('<% x -%>\nb\n')).toEqual([{ rendered: 'b\n', renderedOffsets: [9, 10, 11] }]);
    expect(renderedOf('<% x -%>\n\nb')).toEqual([{ rendered: '\nb', renderedOffsets: [9, 10, 11] }]);
    expect(renderedOf('<% x -%> \nb')).toEqual([{ rendered: ' \nb', renderedOffsets: [8, 9, 10, 11] }]);
  });

  test('a _%> drops the blanks and the first line break of the next text', () => {
    expect(renderedOf('<% x _%> \t\nb')).toEqual([{ rendered: 'b', renderedOffsets: [11, 12] }]);
  });

  test('a \\r\\n or a \\r is the line break dropped', () => {
    expect(renderedOf('<% x -%>\r\nb')).toEqual([{ rendered: 'b', renderedOffsets: [10, 11] }]);
    expect(renderedOf('<% x -%>\rb')).toEqual([{ rendered: 'b', renderedOffsets: [9, 10] }]);
    expect(renderedOf('a\r\n<% x %>\r\n')).toEqual([
      { rendered: 'a\r\n', renderedOffsets: [0, 1, 2, 3] },
      { rendered: '\r\n', renderedOffsets: [10, 11, 12] },
    ]);
  });

  test('<%% renders <% and %%> renders %>, the extra % mapping to nothing', () => {
    expect(renderedOf('a <%% b %%> c')).toEqual([
      { rendered: 'a <% b %> c', renderedOffsets: [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13] },
    ]);
  });

  test('the next close delimiter after <%% is written, ending the literal mode', () => {
    expect(renderedOf('<%% x %> y %>')).toEqual([
      { rendered: '<% x %> y ', renderedOffsets: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    ]);
    // A written -%> drops the line break after it, which the end of the text is after.
    expect(renderedOf('<%% x -%>\ny')).toEqual([
      { rendered: '<% x -%>y', renderedOffsets: [0, 1, 3, 4, 5, 6, 7, 8, 10, 11] },
    ]);
    expect(renderedOf('<%% -%>\n')).toEqual([{ rendered: '<% -%>', renderedOffsets: [0, 1, 3, 4, 5, 6, 8] }]);
    // A written _%> slurps the blanks after it, which the end of the text is after.
    expect(renderedOf('<%% _%> \t')).toEqual([{ rendered: '<% _%>', renderedOffsets: [0, 1, 3, 4, 5, 6, 9] }]);
  });

  test('a tag ends the literal mode', () => {
    expect(renderedOf('<%% a<%= b %> c %>')).toEqual([
      { rendered: '<% a', renderedOffsets: [0, 1, 3, 4, 5] },
      { rendered: ' c ', renderedOffsets: [13, 14, 15, 16] },
    ]);
  });

  test('a stray close delimiter is dropped', () => {
    expect(renderedOf('a %> b')).toEqual([{ rendered: 'a  b', renderedOffsets: [0, 1, 4, 5, 6] }]);
    expect(renderedOf('a -%>\nb')).toEqual([{ rendered: 'a b', renderedOffsets: [0, 1, 6, 7] }]);
    expect(renderedOf('a _%> \t\nb')).toEqual([{ rendered: 'a b', renderedOffsets: [0, 1, 8, 9] }]);
    // A %> after a -%> keeps the line break.
    expect(renderedOf('<% x -%>%>\nb')).toEqual([{ rendered: '\nb', renderedOffsets: [10, 11, 12] }]);
  });

  test('a text with nothing rendered ends after what the tag before it slurps', () => {
    expect(renderedOf('<%_ a _%>\n  <%_ b _%>')).toEqual([{ rendered: '', renderedOffsets: [10] }]);
    expect(renderedOf('<%_ a _%>  ')).toEqual([{ rendered: '', renderedOffsets: [11] }]);
    expect(renderedOf('<% a %>  <%_ b _%>')).toEqual([{ rendered: '', renderedOffsets: [7] }]);
  });

  test('a text ends before the blanks a <%_ after it slurps', () => {
    expect(renderedOf('<%_ a _%>\n  b  <%_ c _%>')).toEqual([{ rendered: '  b', renderedOffsets: [10, 11, 12, 13] }]);
  });

  test('the texts of a loop', () => {
    expect(
      renderedOf(`<%_ for (const field of fields) { _%>
  <%= field.name %>
<%_ } _%>
`),
    ).toEqual([
      { rendered: '  ', renderedOffsets: [38, 39, 40] },
      { rendered: '\n', renderedOffsets: [57, 58] },
      { rendered: '', renderedOffsets: [68] },
    ]);
  });
});

describe('rendered, against EJS', () => {
  const pieces = [
    'a',
    ' ',
    '\t',
    '\n',
    '\r\n',
    '<%%',
    '%%>',
    '%>',
    '-%>',
    '_%>',
    '<% %>',
    '<%_ _%>',
    '<% -%>',
    '<%= 1 -%>',
  ];
  const templates = pieces.flatMap((first) =>
    pieces.flatMap((second) => pieces.map((third) => `${first}${second}${third}`)),
  );

  test('EJS renders the texts of a template with its tags emptied', () => {
    const mismatches: { template: string; ejs: string; rendered: string }[] = [];
    for (const text of templates) {
      const template = buildTemplate(text);
      try {
        const source = emptied(template);
        const rendered = template.nodes.map((node) => (node.kind === 'text' ? node.rendered : '')).join('');
        if (ejs.render(source) !== rendered) mismatches.push({ template: text, ejs: ejs.render(source), rendered });
      } finally {
        cleanupTemplate(template);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('a character inserted at the end of a text renders after what it renders, and drops nothing more', () => {
    const mismatches: { template: string; at: number; ejs: string; expected: string }[] = [];
    for (const text of templates) {
      const template = buildTemplate(emptied(buildTemplateAndFree(text)));
      try {
        const source = template.text;
        const texts = template.nodes.filter((node) => node.kind === 'text');
        for (const [index, { renderedOffsets }] of texts.entries()) {
          const at = renderedOffsets[renderedOffsets.length - 1];
          const joined = (from: number, to?: number) =>
            texts
              .slice(from, to)
              .map((node) => node.rendered)
              .join('');
          const expected = `${joined(0, index + 1)}X${joined(index + 1)}`;
          const rendered = ejs.render(`${source.slice(0, at)}X${source.slice(at)}`);
          if (rendered !== expected) mismatches.push({ template: source, at, ejs: rendered, expected });
        }
      } finally {
        cleanupTemplate(template);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/** The template built, freed: its nodes without their trees. */
function buildTemplateAndFree(text: string): EjsTemplate {
  const template = buildTemplate(text);
  cleanupTemplate(template);
  return template;
}
