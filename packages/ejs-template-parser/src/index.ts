// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

export { findErrorNode, parseEjs, parseJavaScript, type SyntaxNode, type Tree } from './ts-parser.js';
export { parseJavaScriptPartial, type RelativeJavascriptNode } from './javascript-parser.js';
export {
  EJS_CLOSING_DELIMS,
  EJS_OPENING_DELIMS,
  type EjsClosingDelimiter,
  type EjsOpeningDelimiter,
  type EjsSyntaxNode,
  getCommentCloseDelimiter,
  getDirectiveCodeText,
  getEjsNodes,
  hasAbsorbedSlurpClose,
} from './ejs-parser.js';
export { type EjsCodeTag, type EjsCommentTag, type EjsTag, type EjsTagType, getEjsTags, isTagNode } from './tags.js';
export {
  type EjsBlock,
  type EjsBranch,
  type EjsTemplate,
  type EjsTemplateNode,
  type EjsText,
  parseTemplate,
} from './template.js';
