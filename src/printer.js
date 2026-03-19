'use strict';

const { hardline } = require('prettier').doc.builders;

/**
 * Determine whether the file is an HTML EJS file.
 * @param {string|undefined} filepath
 * @returns {boolean}
 */
function isHtmlEjs(filepath) {
  return typeof filepath === 'string' && filepath.endsWith('.html.ejs');
}

/**
 * Format a single EJS tag.
 *
 * Rules:
 *  - Tag content is trimmed (leading/trailing whitespace removed).
 *  - Multiline content is collapsed to a single line (lines are trimmed and
 *    joined with a single space, empty lines are ignored).
 *  - Exactly one space is placed before and after the content.
 *  - `<%-` is preferred over `<%=` for non-.html.ejs files.
 *
 * @param {string} open     - Opening delimiter e.g. `<%_`, `<%=`, `<%-`, `<%`
 * @param {string} content  - Raw content between delimiters
 * @param {string} close    - Closing delimiter e.g. `_%>`, `-%>`, `%>`
 * @param {boolean} htmlEjs - Whether the file is a .html.ejs file
 * @returns {string}        - Formatted tag string
 */
function formatTag(open, content, close, htmlEjs) {
  // Collapse multiline content: trim each line, filter empty, join with space
  const singleLine = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join(' ');

  // Convert <%=  to <%- for non-.html.ejs files
  let formattedOpen = open;
  if (!htmlEjs && open === '<%=') {
    formattedOpen = '<%-';
  }

  // If content is empty after trimming, emit a single space between delimiters
  if (singleLine === '') {
    return `${formattedOpen} ${close}`;
  }

  return `${formattedOpen} ${singleLine} ${close}`;
}

/**
 * Print the root AST node into a prettier Doc.
 *
 * @param {import('prettier').AstPath} path
 * @param {import('prettier').Options} options
 * @returns {import('prettier').Doc}
 */
function print(path, options) {
  const node = path.getValue();

  if (node.type !== 'root') {
    return '';
  }

  const htmlEjsFile = isHtmlEjs(options.filepath);
  const parts = [];

  for (const child of node.children) {
    if (child.type === 'text') {
      parts.push(child.value);
    } else if (child.type === 'tag') {
      parts.push(formatTag(child.open, child.content, child.close, htmlEjsFile));
    }
  }

  // Build the doc: the formatted text followed by a hard newline to ensure
  // prettier always writes a trailing newline.
  const text = parts.join('');
  // Strip any existing trailing newline(s) before adding exactly one
  const stripped = text.replace(/\n+$/, '');
  return [stripped, hardline];
}

module.exports = { print, formatTag, isHtmlEjs };

