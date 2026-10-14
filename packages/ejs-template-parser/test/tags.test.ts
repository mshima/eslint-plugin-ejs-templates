// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { getEjsNodes } from '../src/ejs-parser.js';
import { type EjsTag, getEjsTags, programOf } from '../src/tags.js';

/**
 * The tags of `text`, with their trees freed: the fields the tests read stay valid, and leaking the trees
 * exhausts the WASM heap.
 */
function tagsOf(text: string): EjsTag[] {
  const nodes = getEjsNodes(text);
  const tags = getEjsTags(nodes);
  for (const tag of tags) if (tag.type !== 'comment') tag.javascript.cleanup();
  nodes[0]?.tree.delete();
  return tags;
}

/** The fields of a tag a test asserts, without its tree-sitter node and its JavaScript. */
function fieldsOf(tag: EjsTag): Partial<EjsTag> {
  const fields: Partial<EjsTag> = { ...tag };
  delete fields.node;
  if ('javascript' in fields) delete fields.javascript;
  return fields;
}

describe('getEjsNodes', () => {
  test('gives each node the text before it on its line', () => {
    const nodes = getEjsNodes('Hello\n  <%= name %>!');
    try {
      expect(nodes.map((node) => [node.type, node.linePrefix])).toEqual([
        ['content', ''],
        ['output_directive', '  '],
        ['content', '  <%= name %>'],
      ]);
    } finally {
      nodes[0]?.tree.delete();
    }
  });

  test('keeps the escaped delimiters in the text', () => {
    const nodes = getEjsNodes('a <%% b %%> c');
    try {
      expect(nodes.map((node) => [node.type, node.text])).toEqual([['content', 'a <%% b %%> c']]);
    } finally {
      nodes[0]?.tree.delete();
    }
  });

  test('throws with the position of a syntax error', () => {
    // The tag left open: tree-sitter reports the end of the template.
    expect(() => getEjsNodes('a\n<%= b')).toThrow(
      expect.objectContaining({
        message: "Failed to parse EJS template at line 2, column 6: unexpected token ''",
        line: 2,
        column: 6,
      }),
    );
  });
});

describe('getEjsTags', () => {
  test('an output tag in a line of text', () => {
    expect(tagsOf('Hello <%= name %>!').map(fieldsOf)).toEqual([
      {
        kind: 'tag',
        type: 'escaped-output',
        shape: 'escaped-output',
        expectedIndent: '',
        offset: 6,
        length: 11,
        line: 1,
        column: 6,
        codeLine: 1,
        codeColumn: 9,
        openDelim: '<%=',
        closeDelim: '%>',
        code: ' name ',
        parsedCode: ' name',
        linePrefix: 'Hello ',
        isStandalone: false,
        depthBefore: 0,
        depthAfter: 0,
      },
    ]);
  });

  test('a standalone code tag opening a block', () => {
    expect(tagsOf('  <%_ if (x) { _%>').map(fieldsOf)).toEqual([
      {
        kind: 'tag',
        type: 'code',
        shape: 'slurp',
        expectedIndent: '',
        offset: 2,
        length: 16,
        line: 1,
        column: 2,
        codeLine: 1,
        codeColumn: 5,
        openDelim: '<%_',
        closeDelim: '_%>',
        code: ' if (x) { ',
        parsedCode: ' if (x) {',
        linePrefix: '  ',
        isStandalone: true,
        depthBefore: 0,
        depthAfter: 1,
      },
    ]);
  });

  test('a multiline tag, the line break before its closing delimiter left out of the parsed code', () => {
    const [tag] = tagsOf('<%_\n  if (x) {\n_%>');
    expect([tag.code, tag.type !== 'comment' && tag.parsedCode, tag.codeLine, tag.codeColumn]).toEqual([
      '\n  if (x) {\n',
      '\n  if (x) {',
      1,
      3,
    ]);
  });

  test('a comment tag', () => {
    expect(tagsOf('<%# note -%>').map(fieldsOf)).toEqual([
      {
        kind: 'tag',
        type: 'comment',
        offset: 0,
        length: 12,
        line: 1,
        column: 0,
        codeLine: 1,
        codeColumn: 3,
        openDelim: '<%#',
        closeDelim: '-%>',
        code: ' note ',
        linePrefix: '',
        isStandalone: true,
        depthBefore: 0,
        depthAfter: 0,
      },
    ]);
  });

  test.each([
    ['<%- identifier _%>', '_%>', ' identifier '],
    ['<%- identifier_ %>', '%>', ' identifier_ '],
    ['<%- identifier_ _%>', '_%>', ' identifier_ '],
  ])('the _ tree-sitter absorbs from the _%%> of %s goes back to the delimiter', (text, closeDelim, code) => {
    const [tag] = tagsOf(text);
    expect([tag.closeDelim, tag.code]).toEqual([closeDelim, code]);
  });

  test('counts the braces each tag leaves open', () => {
    const tags = tagsOf(
      '<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%= c %>\n<%_ } else if (d) { _%>\n<%_ } _%>\n<%_ } _%>\n',
    );
    expect(tags.map((tag) => [tag.code.trim(), tag.depthBefore, tag.depthAfter])).toEqual([
      ['if (a) {', 0, 1],
      ['if (b) {', 1, 2],
      ['c', 2, 2],
      ['} else if (d) {', 2, 2],
      ['}', 2, 1],
      ['}', 1, 0],
    ]);
  });

  // tree-sitter recovers from the code of the first tag with an error ending with its last statement, not with the
  // `{` of the callback: the braces are counted from its tokens.
  test('counts the braces a tag opens before a statement of its own', () => {
    const tags = tagsOf(
      '<%_ if (a) {\n  x.forEach((f) => {\n    const u = f;\n_%>\n<%_ if (u) { _%>\nu\n<%_ } _%>\n<%_ });\n} _%>\n',
    );
    expect(tags.map((tag) => [tag.code.trim().replace(/\s+/gu, ' '), tag.depthBefore, tag.depthAfter])).toEqual([
      ['if (a) { x.forEach((f) => { const u = f;', 0, 2],
      ['if (u) {', 2, 3],
      ['}', 3, 2],
      ['}); }', 2, 0],
    ]);
  });

  test('a partial template closing a block another template opens goes below zero', () => {
    expect(tagsOf('A\n<%_ } _%>\nB').map((tag) => [tag.depthBefore, tag.depthAfter])).toEqual([[0, -1]]);
  });

  // A template whose program parses has its tags read there: a statement without its semicolon, which the `;` EJS adds
  // ends, parses alone; a case, which goes on in the tags after it, does not.
  test.each([
    ['a statement without its semicolon', '<% const a = 1 %>\nx\n', 0, true, 'code-slurpable'],
    ['a case of a switch', '<% switch (k) { %><% case 1: %>one<% } %>', 1, false, 'code'],
    ['an if opening a block', '<% if (a) { %>A<% } %>', 0, false, 'code'],
    ['a tag in a template string across tags', '<% const s = `%>x<% a %>y<%` %>', 1, false, 'code'],
  ])('whether a tag parses alone, read in the program: %s', (_label, text, index, alone, shape) => {
    const tag = tagsOf(text)[index];
    expect(tag.type === 'comment' ? undefined : [tag.javascript.parsesAlone, tag.shape]).toEqual([alone, shape]);
  });

  // The code a comment across tags comments out is a comment of the program, as EJS compiles it: its braces open and
  // close no block, and the code of the tags it covers, which is the comment's, does not parse alone.
  test('the braces of the code a comment across tags comments out open no block', () => {
    expect(
      tagsOf('<% /* %><% if (a) { %>A<% } */ %>').map((tag) => [
        tag.depthBefore,
        tag.depthAfter,
        tag.type !== 'comment' && tag.javascript.parsesAlone,
      ]),
    ).toEqual([
      [0, 0, false],
      [0, 0, false],
      [0, 0, false],
    ]);
  });

  // A program with an error is read as tree-sitter recovers it: the braces it adds to recover are none, and a tag with
  // an error does not parse alone.
  test.each([
    [
      'a brace tree-sitter adds',
      '<% x(() => { %>A<% ) %>',
      [
        [0, 1, false, 'code'],
        [1, 1, false, 'code'],
      ],
    ],
    [
      'an error in a tag',
      '<% a b %>\n<% c %>\n',
      [
        [0, 0, false, 'code'],
        [0, 0, true, 'code-slurpable'],
      ],
    ],
  ])('a template whose program has an error: %s', (_label, text, expected) => {
    expect(
      tagsOf(text).map((tag) =>
        tag.type === 'comment' ? undefined : [tag.depthBefore, tag.depthAfter, tag.javascript.parsesAlone, tag.shape],
      ),
    ).toEqual(expected);
  });

  // A partial template is read in its program once the blocks its tags close without opening are opened before them,
  // and the ones they leave open closed after them.
  test('a partial template is read in its program, its blocks balanced', () => {
    const tags = tagsOf('A\n<%_ } _%>\nB\n<% c %>\n<% if (d) { %>\n');
    expect(
      tags.map((tag) =>
        tag.type === 'comment' ? undefined : [tag.depthBefore, tag.depthAfter, tag.javascript.parsesAlone, tag.shape],
      ),
    ).toEqual([
      [0, -1, false, 'slurp'],
      [-1, -1, true, 'code-slurpable'],
      [-1, 0, false, 'code'],
    ]);
    const [first] = tags;
    expect(first.type !== 'comment' && programOf(first)?.source).toBe(
      'function __ejs_template__() {\n{\n;__append(0)\n; } \n;__append(0)\n; c \n;__append(0)\n; if (d) { \n;__append(0)\n}\n}\n',
    );
  });
});
