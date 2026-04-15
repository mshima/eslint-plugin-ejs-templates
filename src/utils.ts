import { getTagTypeFromLine } from './ejs-parser.js';

type CommentWithTagType<C extends { type: string; value: string }> = {
  comment: C;
  tagType: Exclude<ReturnType<typeof getTagTypeFromLine>, null>;
};

export const getTagTypeComments = <C extends { type: string; value: string }>(comments: C[]): CommentWithTagType<C>[] =>
  comments
    .map((comment) => {
      if (comment.type !== 'Line') return { comment, tagType: null };
      const tagType = getTagTypeFromLine(comment.value);
      return { comment, tagType };
    })
    .filter(({ tagType }) => tagType !== null) as CommentWithTagType<C>[];
