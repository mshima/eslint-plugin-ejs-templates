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
 * `extractTagBlocks` prepends the enclosing brace context to every tag it parses, so the
 * amount of text reaching the parser is what decides whether extraction is linear. If that
 * context is ever allowed to grow with the length of the template rather than with nesting
 * depth, tag N re-parses everything before it and the total goes quadratic — which is the
 * regression these tests exist to catch.
 *
 * Counting characters rather than timing the run keeps the assertion deterministic; a
 * wall-clock budget would flake under CI load and on slower machines.
 */
const parsed = { chars: 0 };

vi.mock('../src/ts-parser.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ts-parser.js')>();
  return {
    ...actual,
    parseJavaScript: (text: string) => {
      parsed.chars += text.length;
      return actual.parseJavaScript(text);
    },
  };
});

const { extractTagBlocks, getEjsNodes } = await import('../src/ejs-parser.js');

/**
 * Characters fed to the JavaScript parser while extracting every tag in `template`.
 *
 * The parse trees are freed afterwards: they live in WASM memory that the garbage
 * collector does not manage, and leaking them across many templates exhausts the heap
 * and aborts the process rather than failing cleanly.
 */
function parsedCharsFor(template: string): number {
  parsed.chars = 0;
  const blocks = extractTagBlocks(getEjsNodes(template));
  try {
    return parsed.chars;
  } finally {
    for (const block of blocks) block.javascriptPartialNode?.cleanup();
  }
}

/** `n` sibling `<% if %>` blocks, each opened and closed — nesting never exceeds 1. */
const siblingBlocks = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<% if (v${String(i)}) { %>\n  <%= x${String(i)} %>\n<% } %>\n`).join('');

/**
 * A single `if` / `else if` ladder of `n` branches.
 *
 * Every branch sits at the same depth and closes nothing on its own, so a ladder only
 * stays linear if same-depth continuations supersede one another instead of stacking.
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

describe('extractTagBlocks scaling', () => {
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
        `a factor near 4 means the brace context is growing with template length instead of nesting depth`,
    ).toBeLessThan(MAX_GROWTH_FACTOR);
  });
});
