// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { parseJavaScript, type SyntaxNode } from './ts-parser.js';

export type RelativeJavascriptNode = {
  /**
   * Parser content node corresponding to the original tag content (excluding synthetic wrapper).
   */
  contentNode: SyntaxNode;
  /**
   * Guessed nodes in the content subtree that start within the original content range.
   * Should be used with start offset correction (virtualOffset - start) to map back to original source positions.
   */
  nodes: SyntaxNode[];
  /**
   * Character offset of the content start in the virtual code (after synthetic wrapper) relative to the original content.
   * Should be used nodes position correction when mapping virtual code positions back to original source (virtualOffset - start + originalColumn).
   */
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

/** The tokens of a tree, in order: its leaves, but the ones tree-sitter adds to recover (a missing `}`). */
const tokensOf = (node: SyntaxNode): SyntaxNode[] => {
  if (node.childCount === 0) return node.isMissing ? [] : [node];
  return node.children.flatMap(tokensOf);
};

/**
 * The braces some code leaves open (a `{` without its `}`) and closes without opening (a `}` without its `{`), from
 * its tokens in order, whatever tree-sitter recovers them as: the braces of strings, template strings, regular
 * expressions and comments are no tokens of their own, and the `${` of a template string opens the `}` closing it.
 *
 * The braces of a block comment across tags count, as the ones of the code it comments out: the tags between keep the
 * depth of that code. tree-sitter reads the start of a comment the code does not close as a `/` and a regular
 * expression starting with `*`, whose code is counted from its own tokens; and the end of a comment an earlier tag
 * opens as a `*` and a `/`, side by side, which are left aside.
 */
const countBraces = (root: SyntaxNode, text: string): { open: number; close: number } => {
  let open = 0;
  let close = 0;
  const closeBrace = (): void => {
    if (open > 0) open--;
    else close++;
  };
  const tokens = tokensOf(root);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens.at(index + 1);
    const adjacent = next?.startIndex === token.endIndex;
    if (token.type === '/' && adjacent && next.text.startsWith('*')) {
      const comment = text.slice(next.startIndex + 1);
      const tree = parseJavaScript(comment);
      try {
        const inComment = countBraces(tree.rootNode, comment);
        for (let closed = 0; closed < inComment.close; closed++) closeBrace();
        open += inComment.open;
      } finally {
        tree.delete();
      }
      break;
    }
    if (token.type === '*' && adjacent && next.type === '/') {
      index++;
    } else if (token.type === '{' || token.type === '${') {
      open++;
    } else if (token.type === '}') {
      closeBrace();
    }
  }
  return { open, close };
};

/**
 * Tries to generate a approximate node for a Javascript partial code.
 */
export function parseJavaScriptPartial(text: string, incrementalCode = ''): RelativeJavascriptNode {
  const contentTree = parseJavaScript(text);
  // A balanced snippet has no brace to count; the others are counted by their tokens, not by the errors tree-sitter
  // recovers with, whose text ends with the last statement of the snippet rather than with the `{` it opened.
  const braces = contentTree.rootNode.hasError ? countBraces(contentTree.rootNode, text) : { open: 0, close: 0 };
  const missingCloseBracesCount = braces.open;
  const missingOpenBracesCount = braces.close;
  let wrapperPrefix = '';
  let contentTreeBestGuess: ReturnType<typeof parseJavaScript> | undefined = undefined;
  if (contentTree.rootNode.hasError) {
    const ejsBaseWrapperPrefix = 'function __ejs_brace_probe__() {\n';
    const ejsBaseWrapperSuffix = '\n  foo(); \n}\n';
    wrapperPrefix = ejsBaseWrapperPrefix + incrementalCode;
    const wrapperSuffix = ejsBaseWrapperSuffix + '}\n'.repeat(missingCloseBracesCount);
    contentTreeBestGuess = parseJavaScript(`${wrapperPrefix}${text}${wrapperSuffix}`);
  }

  const contentStart = wrapperPrefix.length;
  const contentEnd = wrapperPrefix.length + text.length;
  const bracesDelta = missingCloseBracesCount - missingOpenBracesCount;
  const nodes = collectNodesStartingInRange((contentTreeBestGuess ?? contentTree).rootNode, contentStart, contentEnd);
  return {
    nodes,
    contentNode: contentTree.rootNode,
    start: contentStart,
    multilineOriginal: text.includes('\n'),
    multilineTrimmed: text.trim().includes('\n'),
    missingCloseBracesCount,
    missingOpenBracesCount,
    bracesDelta,
    hasStructuralBraces: nodes.some(
      (n) => n.type === 'statement_block' || missingCloseBracesCount > 0 || missingOpenBracesCount > 0,
    ),
    cleanup: () => {
      contentTreeBestGuess?.delete();
      contentTree.delete();
    },
    splitStatements: () => {
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
      for (const n of nodes) {
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
          if (parentTypes.includes('call_expression') || parentTypes.includes('try_statement')) {
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
