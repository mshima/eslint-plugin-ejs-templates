// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { type EjsSyntaxNode, parseEjsNodes } from './ejs-parser.js';
import { type EjsCodeTag, type EjsTag, getEjsTags, isTagNode } from './tags.js';
import type { SyntaxNode } from './ts-parser.js';

/**
 * A text of the template between its tags, as written: `<%%` and `%%>` are still escaped, and the
 * whitespace slurped by the delimiters around it still there.
 */
export type EjsText = {
  kind: 'text';
  /** Character offset of the text in the template. */
  offset: number;
  length: number;
  text: string;
};

/** A branch of a block: the tag opening it and what renders inside it. */
export type EjsBranch = {
  /** The tag opening the branch: `<% if (a) { %>`, or the continuation `<% } else { %>` of the branch before. */
  open: EjsCodeTag;
  /**
   * The tree-sitter type of the statement the branch belongs to, when the tag opens a statement block:
   * `if_statement`, `else_clause`, `for_statement`, `for_in_statement` (`for...of` and `for...in`),
   * `while_statement`, `do_statement`, `try_statement`, `catch_clause`, `finally_clause`, `arrow_function`
   * or `function_expression` (a callback, like `forEach(item => {`).
   */
  statement?: string;
  children: EjsTemplateNode[];
};

/**
 * Tags opening and closing braces: an `if` and its `else` branches, a loop, a callback, a `try` and its
 * `catch` and `finally`, a `switch`.
 */
export type EjsBlock = {
  kind: 'block';
  branches: EjsBranch[];
  /** The tag closing the block, absent when the template ends with the block open (a partial template). */
  close?: EjsCodeTag;
};

/**
 * A node of the template tree. A tag opening or closing several blocks (`<% } } %>`) is the `close` (or the
 * `open`) of each of them.
 */
export type EjsTemplateNode = EjsText | EjsTag | EjsBlock;

export type EjsTemplate = {
  /** The texts, tags and blocks of the template, in order: together they cover the whole template. */
  children: EjsTemplateNode[];
  /** Every tag of the template, in order. */
  tags: EjsTag[];
  /**
   * Frees the trees of the template and of the code of its tags, which live in WASM memory the garbage
   * collector does not manage; the nodes of the tags are invalid afterwards, their other fields remain.
   */
  delete: () => void;
};

const CONTINUATION_KEYWORDS = ['else', 'catch', 'finally'];

/** The nodes the code of a tag leaves open: each one the `{` of a block its `}` is not in the tag. */
const openedNodes = (tag: EjsCodeTag): SyntaxNode[] => {
  const end = tag.javascript.start + tag.parsedCode.length;
  return tag.javascript.nodes.filter((node) => node.endIndex > end && node.firstChild?.type === '{');
};

const textOf = (node: EjsSyntaxNode): EjsText => ({
  kind: 'text',
  offset: node.startIndex,
  length: node.endIndex - node.startIndex,
  text: node.text,
});

/**
 * Parse an EJS template into a tree of its texts, its tags and the blocks its tags open and close, from the
 * braces each tag leaves open or closes. Free it with `delete()`.
 *
 * @throws Error if the EJS template has syntax errors
 */
export function parseTemplate(text: string): EjsTemplate {
  const { tree, nodes } = parseEjsNodes(text);
  const tags = getEjsTags(nodes);
  // The tags are the tag nodes, in the same order.
  let tagIndex = 0;
  const children: EjsTemplateNode[] = [];
  const open: { block: EjsBlock; branch: EjsBranch }[] = [];
  const current = (): EjsTemplateNode[] => open.at(-1)?.branch.children ?? children;
  const openBlock = (tag: EjsCodeTag, statement?: string): void => {
    const branch: EjsBranch = { open: tag, statement, children: [] };
    const block: EjsBlock = { kind: 'block', branches: [branch] };
    current().push(block);
    open.push({ block, branch });
  };

  for (const node of nodes) {
    if (!isTagNode(node)) {
      current().push(textOf(node));
      continue;
    }
    const tag = tags[tagIndex++];
    if (tag.type === 'comment' || !tag.javascript.contentNode.hasError) {
      current().push(tag);
      continue;
    }
    const { javascript } = tag;
    const closes = javascript.missingOpenBracesCount;
    const opens = javascript.missingCloseBracesCount;
    // Without the statement a partial template opens elsewhere, tree-sitter recovers with a block of the program.
    const statements = openedNodes(tag).map((node) =>
      node.parent && !['program', 'ERROR'].includes(node.parent.type) ? node.parent.type : undefined,
    );
    // `} else {`, `} catch (e) {`: the next branch of the block, rather than a block closed and another opened.
    const continues =
      closes > 0 && opens > 0 && javascript.nodes.some((node) => CONTINUATION_KEYWORDS.includes(node.type));
    let placed = false;
    for (let closed = 0; closed < (continues ? closes - 1 : closes); closed++) {
      const block = open.pop()?.block;
      if (block) {
        block.close = tag;
        placed = true;
      }
    }
    let opened = 0;
    if (continues) {
      const top = open.at(-1);
      if (top) {
        top.branch = { open: tag, statement: statements[0], children: [] };
        top.block.branches.push(top.branch);
      } else {
        // The block began in another template.
        openBlock(tag, statements[0]);
      }
      opened = 1;
      placed = true;
    }
    for (; opened < opens; opened++) {
      openBlock(tag, statements[opened]);
      placed = true;
    }
    // A `}` whose `{` is in another template.
    if (!placed) current().push(tag);
  }

  return {
    children,
    tags,
    delete: () => {
      for (const tag of tags) {
        if (tag.type !== 'comment') tag.javascript.cleanup();
      }
      tree.delete();
    },
  };
}
