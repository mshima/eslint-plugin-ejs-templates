import { getTagTypeFromLine } from './ejs-parser.js';

type CommentWithTagType<C extends { type: string; value: string }> = {
  comment: C;
  tagType: Exclude<ReturnType<typeof getTagTypeFromLine>, null>;
};

type VirtualMarkerComment = {
  type: 'Line';
  value: string;
  range?: [number, number];
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
};

/**
 * Extract virtual marker comments from source text directly.
 *
 * We intentionally avoid `sourceCode.getAllComments()` because parser comment
 * recovery can miss marker lines when templates contain cross-tag block
 * comments (`/ * ... * /`) that span multiple virtual blocks.
 */
export const getTagTypeComments = (sourceText: string): CommentWithTagType<VirtualMarkerComment>[] => {
  const result: CommentWithTagType<VirtualMarkerComment>[] = [];
  let offset = 0;
  let lineNumber = 1;
  const lineRegex = /([^\r\n]*)(\r\n|\n|$)/gu;

  for (const match of sourceText.matchAll(lineRegex)) {
    const lineText = match[1];
    const lineBreak = match[2];
    if (lineText.startsWith('//@ejs-tag:')) {
      const comment: VirtualMarkerComment = {
        type: 'Line',
        value: lineText.slice(2),
        range: [offset, offset + lineText.length],
        loc: {
          start: { line: lineNumber, column: 0 },
          end: { line: lineNumber, column: lineText.length },
        },
      };

      const tagType = getTagTypeFromLine(comment.value);
      if (tagType !== null) {
        result.push({ comment, tagType });
      }
    }

    if (lineBreak.length === 0) {
      break;
    }

    offset += lineText.length + lineBreak.length;
    lineNumber += 1;
  }

  return result;
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
