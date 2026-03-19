'use strict';

/**
 * EJS tag regex: captures open delimiter, content, and close delimiter
 * Open delimiters: <%, <%=, <%-, <%_, <%#
 * Close delimiters: %>, -%>, _%>
 */
const EJS_TAG_REGEX = /(<%[-=_#]?)([\s\S]*?)([-_]?%>)/g;

/**
 * Parse EJS text into an AST of text and tag nodes.
 *
 * @param {string} text - The EJS source text.
 * @returns {{ type: 'root', children: Array, text: string }}
 */
function parse(text) {
  const children = [];
  let lastIndex = 0;

  EJS_TAG_REGEX.lastIndex = 0;
  let match;

  while ((match = EJS_TAG_REGEX.exec(text)) !== null) {
    const [full, open, content, close] = match;
    const tagStart = match.index;
    const tagEnd = tagStart + full.length;

    // Add preceding text node if any
    if (tagStart > lastIndex) {
      children.push({
        type: 'text',
        value: text.slice(lastIndex, tagStart),
        start: lastIndex,
        end: tagStart,
      });
    }

    // Calculate column position (for indentation awareness)
    const precedingText = text.slice(0, tagStart);
    const lastNewline = precedingText.lastIndexOf('\n');
    const column = lastNewline === -1 ? tagStart : tagStart - lastNewline - 1;

    children.push({
      type: 'tag',
      open,
      content,
      close,
      column,
      start: tagStart,
      end: tagEnd,
    });

    lastIndex = tagEnd;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    children.push({
      type: 'text',
      value: text.slice(lastIndex),
      start: lastIndex,
      end: text.length,
    });
  }

  return {
    type: 'root',
    text,
    children,
    start: 0,
    end: text.length,
  };
}

module.exports = { parse };
