import type { RelativeJavascriptNode, SyntaxNode } from 'ejs-template-parser';

/** The `//@ejs-tag:<type>` comment a block of the virtual code starts with, which a rule reports on. */
export type VirtualMarkerComment = {
  type: 'Line';
  value: string;
  range: [number, number];
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
};

/**
 * Narrow a value to a record so its properties can be read.
 *
 * ESLint types `context.options` as `any[]`, so reading a rule option is otherwise an
 * assertion from `any`. A type predicate narrows it without one. The option has already been
 * validated against the rule's `schema` by the time `create()` runs, so these checks exist to
 * satisfy the type system rather than to guard against shapes that can actually occur.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Narrow a value to an array whose elements still need checking individually. */
export const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/**
 * The tokens of the code of a tag, in order: the leaves of its nodes, but the ones tree-sitter adds to recover (a
 * missing `}`), its comments with them unless `comments` is false. The shape of a tag is told by its tokens rather
 * than by the error tree-sitter recovers from its code alone with, which ejs-template-parser parses only when read.
 */
export const tokensOf = (javascript: RelativeJavascriptNode, { comments = true } = {}): SyntaxNode[] =>
  javascript.nodes.filter((node) => node.childCount === 0 && !node.isMissing && (comments || node.type !== 'comment'));

/** Whether some tokens are of some types, in order. */
export const tokensAre = (tokens: SyntaxNode[], ...types: string[]): boolean =>
  tokens.length === types.length && tokens.every((token, index) => token.type === types[index]);

/**
 * The `if` statement whose keyword is the token at `index`, and whose block the last token opens: `if (…) {` left
 * open, after `} else` for an `else if` link. Null for other tokens.
 */
export const ifOpening = (tokens: SyntaxNode[], index: number): SyntaxNode | null => {
  const keyword = tokens.at(index);
  const last = tokens.at(-1);
  const statement = keyword?.type === 'if' ? keyword.parent : null;
  const block = statement?.type === 'if_statement' ? statement.childForFieldName('consequence') : null;
  return block?.type === 'statement_block' && last?.type === '{' && block.firstChild?.startIndex === last.startIndex
    ? statement
    : null;
};
