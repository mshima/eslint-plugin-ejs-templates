// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

export { findErrorNode, parseEjs, parseJavaScript, type SyntaxNode, type Tree } from './ts-parser.js';
export { type RelativeJavascriptNode } from './javascript-parser.js';
export {
  EJS_CLOSING_DELIMS,
  EJS_OPENING_DELIMS,
  type EjsClosingDelimiter,
  type EjsOpeningDelimiter,
  EjsSyntaxError,
  type EjsSyntaxNode,
  getCommentCloseDelimiter,
  getDirectiveCodeText,
  getEjsNodes,
  hasAbsorbedSlurpClose,
} from './ejs-parser.js';
export {
  type EjsCodeTag,
  type EjsCommentTag,
  type EjsTag,
  type EjsTagShape,
  type EjsTagType,
  getEjsTags,
  isTagNode,
} from './tags.js';
export { escapeText } from './escape-text.js';
export { type EjsEdit, type EjsEditedTemplate, type EjsReplacement, editTemplate } from './edit-template.js';
export { type EjsDiagnostic, type EjsDiagnosticCode } from './diagnostics.js';
export { type EjsFix, type EjsFixOptions, fixOf } from './fixes.js';
export { type EjsRenderedText } from './rendered.js';
export {
  type EjsBlock,
  type EjsBranch,
  type EjsTemplate,
  type EjsTemplateNode,
  type EjsText,
  buildTemplate,
  cleanupTemplate,
  diagnoseTemplate,
  validateTemplate,
} from './template.js';
