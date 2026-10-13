// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import type { EjsTag } from '../src/tags.js';
import { type EjsTemplate, type EjsTemplateNode, buildTemplate, cleanupTemplate } from '../src/template.js';

type Summary =
  string | { branches: { open: string; statement?: string; children: Summary[] }[]; close?: string | undefined };

/** The tree of a template, each text as written, each tag by its source, each block by the code of its tags. */
function summarize(text: string, nodes: EjsTemplateNode[]): Summary[] {
  const source = (tag: EjsTag) => text.slice(tag.offset, tag.offset + tag.length);
  return nodes.map((node) => {
    if (node.kind === 'text') return node.text;
    if (node.kind === 'tag') return source(node);
    return {
      branches: node.branches.map((branch) => ({
        open: branch.open.code.trim(),
        statement: branch.statement,
        children: summarize(text, branch.children),
      })),
      close: node.close?.code.trim(),
    };
  });
}

/** The template tree of `text`, summarized, its trees freed. */
function treeOf(text: string): Summary[] {
  const template = buildTemplate(text);
  try {
    return summarize(text, template.children);
  } finally {
    cleanupTemplate(template);
  }
}

/** The template written back from its tree, each tag once even when it opens or closes several blocks. */
function writeBack(text: string, template: EjsTemplate): string {
  const written = new Set<EjsTag>();
  const parts: string[] = [];
  const writeTag = (tag: EjsTag) => {
    if (written.has(tag)) return;
    written.add(tag);
    parts.push(text.slice(tag.offset, tag.offset + tag.length));
  };
  const write = (nodes: EjsTemplateNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') parts.push(node.text);
      else if (node.kind === 'tag') writeTag(node);
      else {
        for (const branch of node.branches) {
          writeTag(branch.open);
          write(branch.children);
        }
        if (node.close) writeTag(node.close);
      }
    }
  };
  write(template.children);
  return parts.join('');
}

describe('buildTemplate', () => {
  test('an if with its else if and else branches', () => {
    expect(
      treeOf('A\n<%_ if (x) { _%>\nB <%= y %>\n<%_ } else if (z) { _%>\nC\n<%_ } else { _%>\nD\n<%_ } _%>\nE\n'),
    ).toEqual([
      'A\n',
      {
        branches: [
          { open: 'if (x) {', statement: 'if_statement', children: ['\nB ', '<%= y %>', '\n'] },
          { open: '} else if (z) {', statement: 'if_statement', children: ['\nC\n'] },
          { open: '} else {', statement: 'else_clause', children: ['\nD\n'] },
        ],
        close: '}',
      },
      '\nE\n',
    ]);
  });

  test('loops and callbacks, a block inside another', () => {
    expect(
      treeOf(
        '<%_ for (const field of fields) { _%>\n<%_ field.values.forEach(value => { _%>\n<%= value %>\n<%_ }); _%>\n<%_ } _%>\n',
      ),
    ).toEqual([
      {
        branches: [
          {
            open: 'for (const field of fields) {',
            statement: 'for_in_statement',
            children: [
              '\n',
              {
                branches: [
                  {
                    open: 'field.values.forEach(value => {',
                    statement: 'arrow_function',
                    children: ['\n', '<%= value %>', '\n'],
                  },
                ],
                close: '});',
              },
              '\n',
            ],
          },
        ],
        close: '}',
      },
      '\n',
    ]);
  });

  test('try, catch and finally branches', () => {
    expect(treeOf('<% try { %>t<% } catch (e) { %>c<% } finally { %>f<% } %>')).toEqual([
      {
        branches: [
          { open: 'try {', statement: 'try_statement', children: ['t'] },
          { open: '} catch (e) {', statement: 'catch_clause', children: ['c'] },
          { open: '} finally {', statement: 'finally_clause', children: ['f'] },
        ],
        close: '}',
      },
    ]);
  });

  test('a switch, its cases tags inside its block', () => {
    expect(treeOf('<% switch (k) { %><% case 1: %>one<% break; %><% } %>')).toEqual([
      {
        branches: [{ open: 'switch (k) {', statement: undefined, children: ['<% case 1: %>', 'one', '<% break; %>'] }],
        close: '}',
      },
    ]);
  });

  test('a tag closing a block and opening the next one, not a branch of it', () => {
    expect(treeOf('<% a.forEach(i => { %>A<% }); b.forEach(j => { %>B<% }); %>')).toEqual([
      {
        branches: [{ open: 'a.forEach(i => {', statement: 'arrow_function', children: ['A'] }],
        close: '}); b.forEach(j => {',
      },
      { branches: [{ open: '}); b.forEach(j => {', statement: 'arrow_function', children: ['B'] }], close: '});' },
    ]);
  });

  test('a tag opening, or closing, two blocks at once', () => {
    expect(treeOf('<% if (a) { if (b) { %>x<% } } %>')).toEqual([
      {
        branches: [
          {
            open: 'if (a) { if (b) {',
            statement: 'if_statement',
            children: [
              {
                branches: [{ open: 'if (a) { if (b) {', statement: 'if_statement', children: ['x'] }],
                close: '} }',
              },
            ],
          },
        ],
        close: '} }',
      },
    ]);
  });

  test('a balanced tag is a tag, not a block', () => {
    expect(treeOf('<% if (a) { b(); } %>x')).toEqual(['<% if (a) { b(); } %>', 'x']);
  });

  test('a partial template: a block it closes, or continues, and a block it leaves open', () => {
    expect(treeOf('A<% } %>B<% } else { %>C<% } %>D<% if (e) { %>E')).toEqual([
      'A',
      '<% } %>',
      'B',
      // Its if in another template, tree-sitter cannot tell the statement.
      { branches: [{ open: '} else {', statement: undefined, children: ['C'] }], close: '}' },
      'D',
      { branches: [{ open: 'if (e) {', statement: 'if_statement', children: ['E'] }], close: undefined },
    ]);
  });

  test('covers the whole template, every tag once', () => {
    const text =
      '<%# a comment -%>\nA <%%= literal %%>\n<%_ if (a) { _%>\n  <%_ items.forEach(item => { _%>\n<%- item %>\n  <%_ }); _%>\n<%_ } else if (b) { if (c) { _%>\nC\n<%_ } } else { _%>\nD\n<%_ } _%>\n';
    const template = buildTemplate(text);
    try {
      expect(writeBack(text, template)).toBe(text);
      expect(template.tags.map((tag) => text.slice(tag.offset, tag.offset + tag.length))).toEqual([
        '<%# a comment -%>',
        '<%_ if (a) { _%>',
        '<%_ items.forEach(item => { _%>',
        '<%- item %>',
        '<%_ }); _%>',
        '<%_ } else if (b) { if (c) { _%>',
        '<%_ } } else { _%>',
        '<%_ } _%>',
      ]);
    } finally {
      cleanupTemplate(template);
    }
  });

  test('keeps the fields of its tags once freed', () => {
    const template = buildTemplate('<%= a %>');
    cleanupTemplate(template);
    expect(template.tags.map((tag) => [tag.type, tag.code])).toEqual([['escaped-output', ' a ']]);
  });
});
