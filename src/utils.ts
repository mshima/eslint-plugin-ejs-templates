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
