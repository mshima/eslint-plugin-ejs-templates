// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { type EjsDiagnostic, diagnose } from './diagnostics.js';
import { EjsSyntaxError, type EjsSyntaxNode, parseEjsNodes } from './ejs-parser.js';
import { type EjsRenderedText, renderText } from './rendered.js';
import { type EjsCodeTag, type EjsTag, getEjsTags, isTagNode } from './tags.js';
import type { SyntaxNode } from './ts-parser.js';

/**
 * A text of the template between its tags, as written: `<%%` and `%%>` are still escaped, and the
 * whitespace slurped by the delimiters around it still there; and what EJS renders of it.
 */
export type EjsText = EjsRenderedText & {
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
   * `while_statement`, `do_statement`, `try_statement`, `catch_clause`, `finally_clause`, `switch_statement`,
   * `arrow_function` or `function_expression` (a callback, like `forEach(item => {`).
   */
  statement?: string | undefined;
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
  /** The template parsed. */
  text: string;
  /** The texts, tags and blocks of the template, in order: together they cover the whole template. */
  children: EjsTemplateNode[];
  /** The texts and the tags of the template, in order, each tag once: the template written back, joined. */
  nodes: (EjsText | EjsTag)[];
  /** Every tag of the template, in order. */
  tags: EjsTag[];
  /**
   * Frees the trees of the template, once, what cleanupTemplate runs: `using template = buildTemplate(text)` frees it
   * at the end of the block.
   */
  [Symbol.dispose]: () => void;
};

const CONTINUATION_KEYWORDS = ['else', 'catch', 'finally'];

/** What validateTemplate reads of a template buildTemplate built: its blocks without a pair, and whether it is freed. */
const builtTemplates = new WeakMap<EjsTemplate, { unclosed: EjsCodeTag[]; unopened: EjsCodeTag[]; freed: boolean }>();

/** The nodes the code of a tag leaves open: each one the `{` of a block its `}` is not in the tag. */
const openedNodes = (tag: EjsCodeTag): SyntaxNode[] => {
  const end = tag.javascript.start + tag.parsedCode.length;
  return tag.javascript.nodes.filter((node) => node.endIndex > end && node.firstChild?.type === '{');
};

/** A text of the template, between the tags `before` and `after` (none at the start or the end of the template). */
const textOf = (node: EjsSyntaxNode, before?: EjsTag, after?: EjsTag): EjsText => {
  const text = { offset: node.startIndex, text: node.text };
  // What EJS renders of the text, rendered when read: most texts are never.
  let rendering: EjsRenderedText | undefined;
  const render = (): EjsRenderedText => (rendering ??= renderText(text, before?.closeDelim, after?.openDelim));
  return {
    kind: 'text',
    offset: text.offset,
    length: node.endIndex - node.startIndex,
    text: text.text,
    get rendered() {
      return render().rendered;
    },
    get renderedOffsets() {
      return render().renderedOffsets;
    },
  };
};

/**
 * Builds the tree of an EJS template: its texts, its tags and the blocks its tags open and close, from the braces
 * each tag leaves open or closes. Its trees live in WASM memory, which the garbage collector does not manage:
 * - declared with `const`, as on Node 22, which has no `using`, the template is freed by cleanupTemplate, called once
 *   done with it, in a `finally`;
 * - declared with `using`, on Node 24 or in code compiled for an older Node, it is freed at the end of its block,
 *   without cleanupTemplate.
 *
 * @throws EjsSyntaxError if the EJS template has syntax errors, a tag left open: with its `line`, its `column` and
 * its `syntax-error` diagnostic (`diagnostic`)
 */
export function buildTemplate(text: string): EjsTemplate {
  const { tree, nodes } = parseEjsNodes(text);
  const tags = getEjsTags(nodes);
  // The tags are the tag nodes, in the same order.
  let tagIndex = 0;
  const children: EjsTemplateNode[] = [];
  const ordered: (EjsText | EjsTag)[] = [];
  /** The tags closing a block no tag before them opens. */
  const unopened: EjsCodeTag[] = [];
  const open: { block: EjsBlock; branch: EjsBranch }[] = [];
  const current = (): EjsTemplateNode[] => open.at(-1)?.branch.children ?? children;
  const openBlock = (tag: EjsCodeTag, statement?: string): void => {
    const branch: EjsBranch = { open: tag, statement, children: [] };
    const block: EjsBlock = { kind: 'block', branches: [branch] };
    current().push(block);
    open.push({ block, branch });
  };

  for (const [index, node] of nodes.entries()) {
    if (!isTagNode(node)) {
      const before = index > 0 && isTagNode(nodes[index - 1]) ? tags[tagIndex - 1] : undefined;
      const after = index + 1 < nodes.length && isTagNode(nodes[index + 1]) ? tags[tagIndex] : undefined;
      const text = textOf(node, before, after);
      current().push(text);
      ordered.push(text);
      continue;
    }
    const tag = tags[tagIndex++];
    ordered.push(tag);
    if (tag.type === 'comment' || tag.javascript.parsesAlone) {
      current().push(tag);
      continue;
    }
    const { javascript } = tag;
    const closes = javascript.missingOpenBracesCount;
    const opens = javascript.missingCloseBracesCount;
    // Without the statement a partial template opens elsewhere, tree-sitter recovers with a block of the program, or
    // of the blocks the program opens for the ones its tags close without opening: a bare block is no statement.
    const statements = openedNodes(tag).map((node) =>
      node.parent && !['program', 'ERROR', 'statement_block'].includes(node.parent.type) ? node.parent.type : undefined,
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
      } else {
        unopened.push(tag);
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
        unopened.push(tag);
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

  const built = { unclosed: open.map(({ block }) => block.branches[0].open), unopened, freed: false };
  const template: EjsTemplate = {
    text,
    children,
    nodes: ordered,
    tags,
    // Its trees deleted, once: the ones of the code of its tags, and its own.
    [Symbol.dispose]: () => {
      if (built.freed) return;
      built.freed = true;
      for (const tag of tags) {
        if (tag.type !== 'comment') tag.javascript.cleanup();
      }
      tree.delete();
    },
  };
  builtTemplates.set(template, built);
  return template;
}

/**
 * Frees the trees of a template buildTemplate built, which live in WASM memory the garbage collector does not manage:
 * left behind, a few hundred templates exhaust it and abort the process. The nodes of its tags are invalid afterwards,
 * their other fields remain. Once: called again, it does nothing.
 */
export function cleanupTemplate(template: EjsTemplate): void {
  template[Symbol.dispose]();
}

/**
 * The diagnostics of a template buildTemplate built, before cleanupTemplate frees it (they read the JavaScript of its
 * tags): what EJS fails on or renders otherwise than written (errors), and what is out of the conventions of
 * eslint-plugin-ejs-templates (warnings), in order (see EjsDiagnosticCode). A template that does not parse has its
 * `syntax-error` diagnostic on the EjsSyntaxError buildTemplate throws; diagnoseTemplate gives it instead.
 */
export function validateTemplate(template: EjsTemplate): EjsDiagnostic[] {
  const built = liveTemplate(template, 'validateTemplate');
  return diagnose(template.text, template.nodes, built.unclosed, built.unopened);
}

/**
 * What buildTemplate keeps of a template, which a function of the parser reads before cleanupTemplate frees it: it
 * throws otherwise, telling the function.
 */
export function liveTemplate(
  template: EjsTemplate,
  caller: string,
): { unclosed: EjsCodeTag[]; unopened: EjsCodeTag[] } {
  const built = builtTemplates.get(template);
  if (!built) throw new Error(`${caller} reads a template buildTemplate built`);
  if (built.freed) throw new Error(`${caller} reads a template before cleanupTemplate frees it`);
  return built;
}

/**
 * The diagnostics of a template text, in one call: builds the template, validates it (see validateTemplate) and frees
 * it. A template that does not parse has its `syntax-error` diagnostic alone, instead of the EjsSyntaxError
 * buildTemplate throws.
 */
export function diagnoseTemplate(text: string): EjsDiagnostic[] {
  let template: EjsTemplate;
  try {
    template = buildTemplate(text);
  } catch (error) {
    // buildTemplate throws an EjsSyntaxError alone, but for a bug.
    /* v8 ignore next -- @preserve */
    if (!(error instanceof EjsSyntaxError)) throw error;
    return [error.diagnostic];
  }
  try {
    return validateTemplate(template);
  } finally {
    cleanupTemplate(template);
  }
}
