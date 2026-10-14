// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { getCommentCloseDelimiter, getDirectiveCodeText, getEjsNodes } from '../src/ejs-parser.js';
import type { RelativeJavascriptNode } from '../src/javascript-parser.js';
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

/** What `read` reads of the code of the code tag at `index` among the tags of `text`, their trees freed after it. */
function readCode<T>(text: string, index: number, read: (javascript: RelativeJavascriptNode) => T): T {
  const nodes = getEjsNodes(text);
  const tags = getEjsTags(nodes);
  try {
    const tag = tags[index];
    if (tag.type === 'comment') throw new Error(`The tag ${String(index)} is a comment`);
    return read(tag.javascript);
  } finally {
    for (const tag of tags) if (tag.type !== 'comment') tag.javascript.cleanup();
    nodes[0]?.tree.delete();
  }
}

/** The fields of a tag a test asserts, without its tree-sitter node and its JavaScript. */
function fieldsOf(tag: EjsTag): Partial<EjsTag> {
  const fields: Partial<EjsTag> = { ...tag };
  delete fields.node;
  if ('javascript' in fields) delete fields.javascript;
  return fields;
}

describe('getEjsNodes', () => {
  // The code of a tag node, without the `_` tree-sitter absorbs from the `_%>` of an output tag.
  test.each([
    ['<% a %>', ' a '],
    ['<%- identifier _%>', ' identifier '],
  ])('the code of the node of %s', (text, code) => {
    const nodes = getEjsNodes(text);
    try {
      expect(getDirectiveCodeText(nodes[0])).toBe(code);
    } finally {
      nodes[0].tree.delete();
    }
  });

  test.each([
    ['<%# a -%>', '-%>'],
    ['<%# a _%>', '_%>'],
    ['<%# a %>', '%>'],
    ['<%# a', '%>'],
  ])('the close delimiter of the comment %s', (text, closeDelim) => {
    expect(getCommentCloseDelimiter(text)).toBe(closeDelim);
  });

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

// The code of a code tag, read in the program of its template: the statements eslint-plugin-ejs-templates splits it
// into, its braces, its nodes.
describe('the code of a tag', () => {
  // The opening and the closing of each block the code leaves open, or closes, are statements of their own.
  test.each([
    ['an expression', '<% x + 1 %>', 0, ['x + 1']],
    ['a block opened, with a statement', '<% if (x) { y; %>A<% } %>', 0, ['if (x) {', 'y;']],
    [
      'a callback opened and closed',
      '<% arr.forEach(x => { console.log(x); }) %>',
      0,
      ['arr.forEach(x => { console.log(x); })'],
    ],
    ['a block opened and closed over lines', '<% if (a) {\n  b();\n} %>', 0, ['if (a) {\n  b();\n}']],
    ['a block opened', '<% for (const item of items) { %>A<% } %>', 0, ['for (const item of items) {']],
    ['a block closed', '<% if (a) { %>A<% } %>', 1, ['}']],
    ['two blocks closed', '<% if (a) { %><% if (b) { %>A<% }} %>', 2, ['}', '}']],
    ['an else', '<% if (a) { %>A<% } else { %>B<% } %>', 1, ['} else {']],
    ['an else without a block', '<% if (a) { %>A<% } else foo; %>', 1, ['} else foo;']],
    [
      'an else if with its block',
      '<% if (a) { %>A<% } else if (foo) { bar() } %>',
      1,
      ['} else if (foo) {', 'bar() ', '}'],
    ],
    [
      'an else with its statements over lines',
      "<% if (foo) { %>A<%\n  } else {\n  const foo = 'bar'\n} %>",
      1,
      ['} else {', "const foo = 'bar'\n", '}'],
    ],
    ['a catch', '<% try { %>A<% } catch (e) { %>B<% } %>', 1, ['} catch (e) {']],
  ])('the statements of %s', (_label, text, index, statements) => {
    expect(readCode(text, index, (javascript) => javascript.splitStatements())).toEqual(statements);
  });

  // Its braces are its `{`, `${` and `}` tokens in the program: not the ones of a string, and the `}` ending the
  // substitution of a template string closes its `${`.
  test.each([
    ['a statement after the brace a callback opens', '<% x.forEach((f) => {\n  const u = f; %>', [1, 0]],
    [
      'statements after the braces of blocks',
      '<% for (r of rs) {\n  if (a) {\n    x.forEach((f) => {\n      const u = 1; %>',
      [3, 0],
    ],
    ['the braces of a callback and of blocks closed', '<% });\n  }\n} %>', [0, 3]],
    ['a block closed before the one left open', '<% if (a) { b(); } else { %>', [1, 0]],
    ['a continuation', '<% } else { %>', [1, 1]],
    ['a brace in a string', "<% x('{'); if (a) { %>", [1, 0]],
    ['the substitution of a template string', '<% x(`${a}`); if (b) { %>', [1, 0]],
  ])('the braces of %s', (_label, text, braces) => {
    expect(
      readCode(text, 0, (javascript) => [javascript.missingCloseBracesCount, javascript.missingOpenBracesCount]),
    ).toEqual(braces);
  });

  // A tag not parsing alone reads its nodes in the program, the ones starting in its code; a tag parsing alone, in its
  // own tree.
  test.each([
    [
      'read in the program',
      '<% if (a) {\nfoo(); %>A<% } %>',
      [
        ['if_statement', 1],
        ['parenthesized_expression', 4],
        ['identifier', 5],
        ['statement_block', 8],
        ['expression_statement', 10],
        ['call_expression', 10],
        ['identifier', 10],
        ['arguments', 13],
      ],
    ],
    [
      'parsing alone',
      '<% const x = 1; %>',
      [
        ['program', 1],
        ['lexical_declaration', 1],
        ['variable_declarator', 7],
        ['identifier', 7],
        ['number', 11],
      ],
    ],
  ])('the named nodes of a tag %s', (_label, text, nodes) => {
    expect(
      readCode(text, 0, (javascript) =>
        javascript.nodes.filter((node) => node.isNamed).map((node) => [node.type, node.startIndex - javascript.start]),
      ),
    ).toEqual(nodes);
  });
});

// The trees of the code of the tags and of the program live in WASM memory, freed with `javascript.cleanup()`.
describe('the trees of the tags', () => {
  test('the tree of the code of a tag is read before its cleanup, which frees it once', () => {
    const nodes = getEjsNodes('<% a %><% if (b) { %>B<% } %>');
    const [first, ...others] = getEjsTags(nodes);
    try {
      if (first.type === 'comment') throw new Error('A code tag');
      first.javascript.cleanup();
      expect(() => first.javascript.contentNode).toThrow(
        'The code of the tag is freed: read its tree before javascript.cleanup()',
      );
      // Freed again, it leaves the program to the tags it still has.
      first.javascript.cleanup();
      const [other] = others;
      expect(other.type !== 'comment' && programOf(other)?.root.type).toBe('program');
    } finally {
      for (const tag of others) if (tag.type !== 'comment') tag.javascript.cleanup();
      nodes[0].tree.delete();
    }
  });

  test('the program is freed with the last tag freed', () => {
    const [tag] = tagsOf('<% a %>');
    const program = tag.type === 'comment' ? undefined : programOf(tag);
    expect(() => program?.root).toThrow(
      'The program of the template is freed: read it before the code of its tags is freed',
    );
  });

  test('a tag without code', () => {
    expect(tagsOf('<%=%>').map((tag) => [tag.code, tag.codeLine, tag.codeColumn])).toEqual([['', 1, 3]]);
  });
});
