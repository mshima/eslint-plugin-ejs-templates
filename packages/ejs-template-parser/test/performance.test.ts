// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect, vi } from 'vitest';

/**
 * Total characters handed to the JavaScript parser, accumulated by the mock below.
 *
 * Building a template parses its program once (`EjsProgram`), and the code of a tag alone when
 * its tree is read, so the amount of text reaching the parser grows with the template. A tag
 * parsed again with the code of the tags before it, as the parser did until it built the
 * program, re-parses everything before it and the total goes quadratic — which is the
 * regression these tests exist to catch.
 *
 * Counting characters rather than timing the run keeps the assertion deterministic; a
 * wall-clock budget would flake under CI load and on slower machines.
 */
const parsed = { chars: 0, calls: 0 };

vi.mock('../src/ts-parser.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ts-parser.js')>();
  return {
    ...actual,
    parseJavaScript: (text: string) => {
      parsed.chars += text.length;
      parsed.calls++;
      return actual.parseJavaScript(text);
    },
  };
});

/**
 * Total characters of the templates escapeText reads to write a text in, accumulated by the mock below: editTemplate
 * writes the texts of a region there, in the part of the template EJS reads the region in.
 */
const escaped = { chars: 0 };

vi.mock('../src/escape-text.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/escape-text.js')>();
  return {
    ...actual,
    escapeText: (template: string, offset: number, text: string) => {
      escaped.chars += template.length;
      return actual.escapeText(template, offset, text);
    },
  };
});

const { buildTemplate, cleanupTemplate, validateTemplate } = await import('../src/template.js');
const { editTemplate } = await import('../src/edit-template.js');

/**
 * Characters fed to the JavaScript parser while building `template` and diagnosing it, which reads
 * its program.
 *
 * The parse trees are freed afterwards: they live in WASM memory that the garbage
 * collector does not manage, and leaking them across many templates exhausts the heap
 * and aborts the process rather than failing cleanly.
 */
function parsedCharsFor(template: string): number {
  parsed.chars = 0;
  const built = buildTemplate(template);
  try {
    validateTemplate(built);
    return parsed.chars;
  } finally {
    cleanupTemplate(built);
  }
}

/** `n` sibling `<% if %>` blocks, each opened and closed — nesting never exceeds 1. */
const siblingBlocks = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<% if (v${String(i)}) { %>\n  <%= x${String(i)} %>\n<% } %>\n`).join('');

/**
 * A single `if` / `else if` ladder of `n` branches.
 *
 * Every branch sits at the same depth and closes nothing on its own: a ladder the context of
 * the tags before each tag made quadratic, unless each continuation superseded the one before.
 */
const elseLadder = (n: number): string => {
  let out = '<% if (c0) { %>\n  <%= v %>\n';
  for (let i = 1; i < n; i++) out += `<% } else if (c${String(i)}) { %>\n  <%= v %>\n`;
  return out + '<% } %>\n';
};

/** `n` sibling `forEach` callbacks, each wrapping a nested `if` — two live levels at a time. */
const nestedCallbacks = (n: number): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `<% items.forEach((item${String(i)}) => { %>\n` +
      `  <% if (item${String(i)}.on) { %><%= item${String(i)}.v %><% } %>\n` +
      `<% }); %>\n`,
  ).join('');

/**
 * Doubling the template must not much more than double the work.
 *
 * Linear extraction measures ~2.0 for each shape below. The quadratic behaviour this
 * guards against measures ~3.7–3.9, so 2.5 separates the two with room for the parser to
 * change how much context it needs without tripping the test.
 */
const MAX_GROWTH_FACTOR = 2.5;

describe('buildTemplate scaling', () => {
  test.each([
    { shape: 'sibling blocks', build: siblingBlocks },
    { shape: 'else ladder', build: elseLadder },
    { shape: 'nested callbacks', build: nestedCallbacks },
  ])('$shape: parser input grows linearly with template size', ({ build }) => {
    const smallChars = parsedCharsFor(build(40));
    const largeChars = parsedCharsFor(build(80));
    const growth = largeChars / smallChars;

    expect(
      growth,
      `doubling the template multiplied parser input by ${growth.toFixed(2)} ` +
        `(${String(smallChars)} -> ${String(largeChars)} chars); ` +
        `a factor near 4 means the code of a tag is parsed again with the code of the tags before it`,
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });
});

describe('buildTemplate parses the JavaScript of a template once', () => {
  // Its tags are read in its program; a tag is parsed alone only when its tree is read.
  test('a template whose program parses', () => {
    parsed.calls = 0;
    const built = buildTemplate(siblingBlocks(3));
    try {
      validateTemplate(built);
      const programOnly = parsed.calls;
      const output = built.tags.find((tag) => tag.type === 'escaped-output');
      expect(output?.type === 'escaped-output' && output.javascript.contentNode.type).toBe('program');
      expect([programOnly, parsed.calls]).toEqual([1, 2]);
    } finally {
      cleanupTemplate(built);
    }
  });

  // A program with an error, or a comment across tags, is read all the same; the one of a partial template is parsed
  // again, its blocks balanced.
  test.each([
    ['a program with an error', '<% a b %>\n<% if (c) { %>x<% } %>\n', 1],
    ['a comment across tags', '<% /* %>x<% */ %>\n<% if (c) { %>x<% } %>\n', 1],
    ['a partial template', 'A\n<% } %>\n<% if (c) { %>x<% } %>\n', 2],
  ])('%s', (_label, text, parses) => {
    parsed.calls = 0;
    const built = buildTemplate(text);
    try {
      validateTemplate(built);
      expect(parsed.calls).toBe(parses);
    } finally {
      cleanupTemplate(built);
    }
  });
});

describe('editTemplate scaling', () => {
  // An edit of each tag of a template built once, as the fixes of the messages of a lint: the template is read once
  // for all of them, and each edit writes its texts in the part of the template around it. Read whole for each edit,
  // the characters would grow as the square of the template.
  const escapedCharsFor = (template: string): { chars: number; nodesRead: number } => {
    const built = buildTemplate(template);
    let nodesRead = 0;
    const counted = new Proxy(built, {
      get: (target, property, receiver) => {
        if (property === 'nodes') nodesRead++;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    escaped.chars = 0;
    try {
      for (const { offset, length } of built.tags) editTemplate(counted, [{ offset, length, text: ['x '] }]);
      return { chars: escaped.chars, nodesRead };
    } finally {
      cleanupTemplate(built);
    }
  };

  test.each([
    { shape: 'sibling blocks', build: siblingBlocks },
    { shape: 'else ladder', build: elseLadder },
    { shape: 'nested callbacks', build: nestedCallbacks },
  ])('$shape: the template is read once, and each edit reads the part around it', ({ build }) => {
    const small = escapedCharsFor(build(40));
    const large = escapedCharsFor(build(80));
    const growth = large.chars / small.chars;

    expect([small.nodesRead, large.nodesRead]).toEqual([1, 1]);
    expect(
      growth,
      `doubling the template multiplied the characters escapeText reads by ${growth.toFixed(2)} ` +
        `(${String(small.chars)} -> ${String(large.chars)} chars); ` +
        `a factor near 4 means each edit writes its texts in the whole template`,
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });
});
