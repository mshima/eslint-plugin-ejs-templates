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

const collectErrorNodes = (node: SyntaxNode | SyntaxNode[]): SyntaxNode[] => {
  const nodes: SyntaxNode[] = [];
  if (Array.isArray(node)) {
    for (const n of node) {
      nodes.push(...collectErrorNodes(n));
    }
    return nodes;
  }
  if (node.isError || node.isMissing) {
    // We may have nodes that starts within the content but ends outside of it (e.g. an unclosed `{` at the end of the content).
    // Include those nodes, but log them for visibility since they may indicate parsing issues.
    nodes.push(node);
  }
  for (const child of node.children) {
    nodes.push(...collectErrorNodes(child));
  }
  return nodes;
};

/**
 * Tries to generate a approximate node for a Javascript partial code.
 */
export function parseJavaScriptPartial(text: string, incrementalCode = ''): RelativeJavascriptNode {
  const contentTree = parseJavaScript(text);
  const isMissingCloseBrace = (n: SyntaxNode) =>
    (n.isError && n.text.trimEnd().endsWith('{')) || (n.isMissing && n.type === '}');
  const isMissingOpenBrace = (n: SyntaxNode) => n.isError && (n.text.trimStart().startsWith('}') || n.type === '}');
  const errorNodes = collectErrorNodes(contentTree.rootNode);
  const missingCloseBracesCount =
    errorNodes
      .filter(isMissingCloseBrace)
      .map((n) => (n.text ? n.text : '{'))
      .join()
      .match(/{/g)?.length ?? 0;
  const missingOpenBracesCount =
    errorNodes
      .filter(isMissingOpenBrace)
      .map((n) => (n.text ? n.text : n.type))
      .join()
      .match(/}/g)?.length ?? 0;
  let wrapperPrefix = '';
  let contentTreeBestGuess: ReturnType<typeof parseJavaScript> | undefined = undefined;
  if (contentTree.rootNode.hasError) {
    const ejsBaseWrapperPrefix = 'function __ejs_brace_probe__() {\n';
    const ejsBaseWrapperSuffix = '\n  foo(); \n}\n';
    wrapperPrefix = ejsBaseWrapperPrefix + incrementalCode;
    const wrapperSuffix = ejsBaseWrapperSuffix + '}\n'.repeat(missingCloseBracesCount);
    contentTreeBestGuess = parseJavaScript(`${wrapperPrefix}${text}${wrapperSuffix}`);
    /*
    const nodesWithErrors = collectErrorNodes(contentTreeBestGuess.rootNode).filter((c) => c.isError);
    if (nodesWithErrors.length > 0) {
      console.log(text);
      console.log(incrementalCode);
      console.log(nodesWithErrors.map((n) => `${n.type}: ${n.text}`).join('\n'));
    }
    */
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
        const trimmedText = statementText.trim();
        if (trimmedText.length === 0) {
          return null;
        }

        if (type === 'open' && trimmedText.startsWith('}')) {
          return { text: trimmedText, type: 'balanced' };
        }

        return { text: trimmedText, type };
      };

      const pushStatement = (statements: SplitStatement[], statementText: string, type: SplitStatementType) => {
        const statement = createStatement(statementText, type);
        if (statement) {
          statements.push(statement);
        }
      };

      let cursor = 0;
      const statements: SplitStatement[] = [];
      for (const n of nodes) {
        let lastCursor = cursor;
        if (STATEMENT_OPEN_IN_SINGLE_LINE.includes(n.type as (typeof STATEMENT_OPEN_IN_SINGLE_LINE)[number])) {
          // else if (foo) {
          if (n.parent?.type === 'else_clause') {
            continue;
          }
          cursor = n.startIndex - contentStart;
          pushStatement(statements, text.slice(lastCursor, cursor), 'text');
        } else if ((n.type === '{' || n.type === '}') && n.parent?.type == 'statement_block') {
          const parentTypes = collectParentTypes(n.parent);
          if (parentTypes.includes('call_expression') || parentTypes.includes('try_statement')) {
            continue;
          }

          if (n.type === '{') {
            cursor = n.endIndex - contentStart;
            pushStatement(statements, text.slice(lastCursor, cursor), 'open');
          } else {
            // Add the content before }.
            cursor = n.startIndex - contentStart;
            pushStatement(statements, text.slice(lastCursor, cursor), 'text');
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
            pushStatement(statements, text.slice(lastCursor, cursor), 'close');
          }
        }
      }
      pushStatement(statements, text.slice(cursor), 'text');

      if (bracesDelta <= 0) {
        return statements.map((s) => s.text);
      }

      // Keep split cardinality aligned with brace imbalance:
      // targetCount = abs(bracesDelta) + 1.
      // Example: delta=1 -> exactly 2 tags (one with extra brace, one balanced remainder).
      const targetCount = Math.abs(bracesDelta) + 1;
      if (statements.length <= targetCount) {
        return statements.map((s) => s.text);
      }

      const statementDelta = (statement: SplitStatement) => {
        if (statement.type === 'open') {
          return 1;
        }
        if (statement.type === 'close') {
          return -1;
        }
        return 0;
      };

      const deltas = statements.map(statementDelta);
      const groups: string[] = [];
      let start = 0;
      let cumulative = 0;
      const splitsNeeded = bracesDelta;

      for (let i = 0; i < statements.length && groups.length < splitsNeeded; i++) {
        cumulative += deltas[i];

        if (cumulative >= groups.length + 1) {
          groups.push(
            statements
              .slice(start, i + 1)
              .map((s) => s.text)
              .join('\n'),
          );
          start = i + 1;
          continue;
        }
      }

      if (start < statements.length) {
        groups.push(
          statements
            .slice(start)
            .map((s) => s.text)
            .join('\n'),
        );
      }

      if (groups.length === 0 || groups.length > targetCount) {
        return statements.map((s) => s.text);
      }

      return groups;
    },
  };
}
