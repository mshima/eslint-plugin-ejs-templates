// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { parseJavaScript, type SyntaxNode, type Tree } from './ts-parser.js';

/** The code of a tag, read in the program of its template (`readTagCode`). */
export type RelativeJavascriptNode = {
  /** The root of the code parsed alone, which a tag parses only when this is read. */
  contentNode: SyntaxNode;
  /** Whether the code parses alone: complete statements, opening and closing no block. */
  parsesAlone: boolean;
  /**
   * The nodes starting in the code, of the program of its template when it does not parse alone, of its own tree
   * otherwise: a node is at `node.startIndex - start` in the code.
   */
  nodes: SyntaxNode[];
  /** Where the code starts in the tree of its nodes: the program of its template, or its own tree (0). */
  start: number;

  cleanup: () => void;
  missingCloseBracesCount: number;
  missingOpenBracesCount: number;
  bracesDelta: number;
  hasStructuralBraces: boolean;
  multilineOriginal: boolean;
  multilineTrimmed: boolean;
  splitStatements: () => string[];
};

const STATEMENT_OPEN_IN_SINGLE_LINE = [
  'if_statement',
  'for_statement',
  'for_in_statement',
  'do_statement',
  'while_statement',
  'switch_statement',
  'try_statement',
  'with_statement',
] as const;

type SplitStatementType = 'open' | 'close' | 'balanced' | 'text';

type SplitStatement = {
  text: string;
  type: SplitStatementType;
};

/** Whether a node is in one of some types of node which end by `end`. */
const closedWithin = (node: SyntaxNode, types: string[], end: number): boolean => {
  for (let ancestor: SyntaxNode | null = node; ancestor; ancestor = ancestor.parent) {
    if (types.includes(ancestor.type) && ancestor.endIndex <= end) return true;
  }
  return false;
};

const collectParentTypes = (node: SyntaxNode): string[] => {
  return [node.type, ...(node.parent ? collectParentTypes(node.parent) : [])];
};

const collectNodesStartingInRange = (node: SyntaxNode, contentStart = 0, contentEnd = Infinity): SyntaxNode[] => {
  const nodes: SyntaxNode[] = [];
  if (node.startIndex >= contentStart && node.startIndex < contentEnd) {
    // We may have nodes that starts within the content but ends outside of it (e.g. an unclosed `{` at the end of the content).
    // Include those nodes, but log them for visibility since they may indicate parsing issues.
    nodes.push(node);
  }
  for (const child of node.children) {
    nodes.push(...collectNodesStartingInRange(child, contentStart, contentEnd));
  }
  return nodes;
};

/** A tree some code is read in, and the offset the code starts at in it. */
export type CodeInTree = { start: number; nodes: () => SyntaxNode[] };

/** Code read in a tree of its own, or of more code where it starts at `start`: the nodes starting in it. */
const codeInTree = (root: SyntaxNode, start: number, length: number): CodeInTree => ({
  start,
  nodes: () => collectNodesStartingInRange(root, start, start + length),
});

/**
 * The nodes of a tree starting in each of some ranges, sorted and apart, in one walk going down only to the nodes
 * across a range: the nodes of each range by its start.
 */
export function collectNodesInRanges(
  root: SyntaxNode,
  ranges: { start: number; end: number }[],
): Map<number, SyntaxNode[]> {
  const nodes = new Map<number, SyntaxNode[]>(ranges.map(({ start }) => [start, []]));
  /** The first range ending after an offset. */
  const rangeAfter = (offset: number) => {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (ranges[middle].end <= offset) low = middle + 1;
      else high = middle;
    }
    return ranges.at(low);
  };
  const visit = (node: SyntaxNode): void => {
    const range = rangeAfter(node.startIndex);
    if (range && range.start <= node.startIndex) nodes.get(range.start)?.push(node);
    for (const child of node.children) {
      // A node starting in a range is in the children across it.
      const next = rangeAfter(child.startIndex);
      if (next && next.start <= child.endIndex) visit(child);
    }
  };
  visit(root);
  return nodes;
}

/** What some code is read as. */
type CodeParts = {
  /** Its tree parsed alone, parsed when first called. */
  alone: () => Tree;
  /** The braces it leaves open (`open`) and the ones it closes without opening (`close`). */
  braces: { open: number; close: number };
  parsesAlone: boolean;
  /** The tree its nodes are read in: its own, or one it is part of, inside the blocks it opens and closes. */
  codeIn: () => CodeInTree;
  /** Frees what it holds: its tree parsed alone, a tree it shares. */
  cleanup: () => void;
};

/** Some code, from what it is read as ({@link CodeParts}). */
function relativeJavascriptNode(text: string, parts: CodeParts): RelativeJavascriptNode {
  const { codeIn } = parts;
  const missingCloseBracesCount = parts.braces.open;
  const missingOpenBracesCount = parts.braces.close;
  const bracesDelta = missingCloseBracesCount - missingOpenBracesCount;
  // The nodes are collected when read: walking a tree marshals each of its nodes out of WASM, and most tags never need
  // them.
  let collected: SyntaxNode[] | undefined;
  const nodesOf = (): SyntaxNode[] => {
    if (collected) return collected;
    return (collected = codeIn().nodes());
  };
  return {
    get nodes() {
      return nodesOf();
    },
    get contentNode() {
      return parts.alone().rootNode;
    },
    parsesAlone: parts.parsesAlone,
    get start() {
      return codeIn().start;
    },
    multilineOriginal: text.includes('\n'),
    multilineTrimmed: text.trim().includes('\n'),
    missingCloseBracesCount,
    missingOpenBracesCount,
    bracesDelta,
    get hasStructuralBraces() {
      return nodesOf().some(
        (n) => n.type === 'statement_block' || missingCloseBracesCount > 0 || missingOpenBracesCount > 0,
      );
    },
    cleanup: parts.cleanup,
    splitStatements: () => {
      const contentStart = codeIn().start;
      const createStatement = (statementText: string, type: SplitStatementType): SplitStatement | null => {
        if (statementText.length === 0) {
          return null;
        }

        if (type === 'open' && statementText.trim().startsWith('}')) {
          return { text: statementText, type: 'balanced' };
        }

        return { text: statementText, type };
      };

      let statements: SplitStatement[] = [];
      const pushStatement = (statementText: string, type: SplitStatementType) => {
        const statement = createStatement(statementText, type);
        if (statement) {
          statements.push(statement);
        }
      };

      let cursor = 0;
      for (const n of nodesOf()) {
        let lastCursor = cursor;
        if (STATEMENT_OPEN_IN_SINGLE_LINE.some((statementType) => statementType === n.type)) {
          // else if (foo) {
          if (n.parent?.type === 'else_clause') {
            continue;
          }
          cursor = n.startIndex - contentStart;
          pushStatement(text.slice(lastCursor, cursor), 'text');
        } else if ((n.type === '{' || n.type === '}') && n.parent?.type == 'statement_block') {
          const parentTypes = collectParentTypes(n.parent);
          // The braces of a callback, or of a try, which the code closes itself, are left in their statement.
          if (closedWithin(n.parent, ['call_expression', 'try_statement'], contentStart + text.length)) {
            continue;
          }

          if (n.type === '{') {
            cursor = n.endIndex - contentStart;
            pushStatement(text.slice(lastCursor, cursor), 'open');
          } else {
            // Add the content before }.
            cursor = n.startIndex - contentStart;
            pushStatement(text.slice(lastCursor, cursor), 'text');
            lastCursor = cursor;

            // Parent is a statement_block, an else/elseif/catch/finally may immediately follow the closing brace.
            const { nextSibling } = n.parent;
            if (nextSibling) {
              continue;
            }

            // If } closes an arrow function body, a ; may follow on the same line, so include it in the statement.
            if (
              parentTypes.length > 4 &&
              parentTypes[1] === 'arrow_function' &&
              parentTypes[2] === 'variable_declarator' &&
              parentTypes[3] === 'lexical_declaration'
            ) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              cursor = n.parent.parent!.parent!.parent!.endIndex - contentStart;
            } else {
              cursor = n.endIndex - contentStart;
            }
            pushStatement(text.slice(lastCursor, cursor), 'close');
          }
        }
      }
      pushStatement(text.slice(cursor), 'text');

      const mergeBalanced = (): boolean => {
        let open: SplitStatement | null = null;
        let balanced: SplitStatement | null = null;
        for (const statement of statements) {
          if (statement.type === 'open') {
            open = statement;
          } else if (statement.type === 'balanced' && open) {
            balanced = statement;
          } else if (statement.type === 'close' && open) {
            open.type = 'text';
            if (balanced) {
              balanced.type = 'text';
            }
            statement.type = 'text';
            return true;
          }
        }
        return false;
      };
      let mergedBalanced = mergeBalanced();
      while (mergedBalanced) {
        mergedBalanced = mergeBalanced();
      }

      const joinTexts = (): void => {
        let textStatement: SplitStatement | null = null;
        for (const statement of statements) {
          if (statement.type === 'text') {
            if (textStatement) {
              textStatement.text += statement.text;
              statement.text = '';
            } else {
              textStatement = statement;
            }
          } else {
            textStatement = null;
          }
        }
        statements = statements.filter((s) => s.text.length > 0);
      };
      joinTexts();

      return statements.map((s) => s.text.trimStart()).filter((s) => s.trim().length > 0);
    },
  };
}

/**
 * The code of a tag read in the program of its template, which tells its braces and whether it parses alone: its nodes
 * are read there when it does not, and in its own tree otherwise, which is parsed only when they, or `contentNode`, are
 * read. `release()` is called when it is freed, for the program to be freed with its last tag.
 */
export function readTagCode(
  text: string,
  read: { braces: { open: number; close: number }; parsesAlone: boolean },
  program: () => CodeInTree,
  release: () => void,
): RelativeJavascriptNode {
  let contentTree: Tree | undefined;
  let freed = false;
  const alone = (): Tree => {
    // Parsed after its cleanup, its tree would never be freed.
    if (freed) throw new Error('The code of the tag is freed: read its tree before javascript.cleanup()');
    return (contentTree ??= parseJavaScript(text));
  };
  return relativeJavascriptNode(text, {
    alone,
    ...read,
    codeIn: read.parsesAlone ? () => codeInTree(alone().rootNode, 0, text.length) : program,
    cleanup: () => {
      if (freed) return;
      freed = true;
      release();
      contentTree?.delete();
      contentTree = undefined;
    },
  });
}
