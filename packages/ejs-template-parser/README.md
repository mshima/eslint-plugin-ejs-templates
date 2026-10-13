# ejs-template-parser

A parser of [EJS](https://ejs.co/) (Embedded JavaScript) templates: the tags of a template, with
their delimiters, their code and its JavaScript parse, and the blocks the tags open and close —
an `if` and its `else` branches, a loop, a callback, a `try` and its `catch`.

Templates are parsed by [tree-sitter-embedded-template] via [web-tree-sitter], and the code of each
tag by [tree-sitter-javascript], inside the blocks the tags before it left open. It is the parser of
[eslint-plugin-ejs-templates].

## Installation

```sh
npm install ejs-template-parser
```

The package is an ES module; the grammars load with it (a top-level `await`), after which every
parse is synchronous.

## Usage

```js
import { parseTemplate } from 'ejs-template-parser';

const template = parseTemplate(`<%_ for (const field of fields) { _%>
  <%= field.name %>
<%_ } _%>
`);
try {
  const [loop] = template.children;
  // loop.kind === 'block'
  // loop.branches[0].open.code === ' for (const field of fields) { '
  // loop.branches[0].statement === 'for_in_statement'
  // loop.branches[0].children: the text '\n  ', the tag <%= field.name %>, the text '\n'
  // loop.close.code === ' } '
} finally {
  template.delete();
}
```

## API

### `parseTemplate(text)`

Parses a template into a tree. Throws, with the `line` and `column` of the error, when the template
has a syntax error (a tag left open).

- `children` — the texts, tags and blocks of the template, in order. Together they cover the whole
  template.
- `tags` — every tag of the template, in order.
- `delete()` — frees the parse trees (see [Memory](#memory)).

A node of the tree is one of:

- **`EjsText`** — `{ kind: 'text', offset, length, text }`: a text between tags, as written. The
  escaped delimiters `<%%` and `%%>` are still there, and so is the whitespace the delimiters
  around the text slurp.
- **`EjsTag`** — `{ kind: 'tag', type, ... }`, where `type` is `'comment'` (`<%#`),
  `'escaped-output'` (`<%=`), `'raw-output'` (`<%-`) or `'code'` (`<%`, `<%_`):
  - `offset`, `length` — the whole tag, delimiters included.
  - `line` (1-based), `column` (0-based) — of the opening delimiter; `codeLine`, `codeColumn` — of
    the code.
  - `openDelim` (`<%`, `<%_`, `<%=`, `<%-`, `<%#`), `closeDelim` (`%>`, `-%>`, `_%>`).
  - `code` — everything between the delimiters.
  - `linePrefix` — the text before the tag on its line; `isStandalone` — only whitespace precedes it.
  - `depthBefore`, `depthAfter` — the braces left open before and after the tag; negative in a
    partial template, whose tags close blocks another template opens.
  - A code or output tag also has `parsedCode` — `code` without the line break or the blank
    separating it from the closing delimiter — and `javascript`, the best-guess parse of
    `parsedCode` (see `parseJavaScriptPartial`); `shape`, how it renders the blanks around it, as
    eslint-plugin-ejs-templates classifies it (`slurp` for `<%_` or `_%>`, `code-slurpable` for a
    `<% %>` opening no block, `code`, or the type of an output tag); and `expectedIndent`, the
    indentation of a slurp tag on a line of its own, two blanks for each block it is in.
- **`EjsBlock`** — `{ kind: 'block', branches, close }`: tags opening and closing braces.
  - `branches` — `{ open, statement, children }` each: the tag opening the branch (`<% if (a) { %>`,
    or the continuation `<% } else { %>` of the branch before), the tree-sitter type of its
    statement when tree-sitter tells it (`if_statement`, `else_clause`, `for_statement`,
    `for_in_statement`, `while_statement`, `do_statement`, `try_statement`, `catch_clause`,
    `finally_clause`, `arrow_function`, `function_expression`), and what renders inside it.
  - `close` — the tag closing the block; absent when the template ends with the block open.

A tag opening or closing several blocks at once (`<% } } %>`) is the `close` (or the `open`) of
each of them. A tag closing a block and opening another one (`<% }); b.forEach(i => { %>`) closes
the first and opens the second; `else`, `catch` and `finally` make a branch of the same block.

### Lower level

- `getEjsNodes(text)` — the top-level tree-sitter nodes of a template, each with its `linePrefix`.
- `getEjsTags(nodes)` — the tags of those nodes, each code tag parsed inside the blocks the tags
  before it left open.
- `parseJavaScriptPartial(code, context)` — a best-guess parse of a snippet of JavaScript with
  unbalanced braces: the braces it leaves open (`missingCloseBracesCount`) and the ones it closes
  (`missingOpenBracesCount`), its nodes, and `splitStatements()`.
- `parseEjs(text)`, `parseJavaScript(text)`, `findErrorNode(node)` — the tree-sitter parsers.
- `hasAbsorbedSlurpClose(node)`, `getDirectiveCodeText(node)`, `getCommentCloseDelimiter(text)`,
  `EJS_OPENING_DELIMS`, `EJS_CLOSING_DELIMS` — the delimiters of a tag node.

## Memory

Parse trees live in WebAssembly memory, which the JavaScript garbage collector does not manage.
Leaking them exhausts the WASM heap after a few hundred templates and aborts the process. Free them
once done: `template.delete()` for `parseTemplate`; for the lower level, `tag.javascript.cleanup()`
for each code tag and `nodes[0].tree.delete()` for the nodes. The fields of a tag other than its
`node` and `javascript` stay valid afterwards.

## Limitations

- The blocks are read from the braces each tag leaves open or closes. A JavaScript comment spanning
  tags (`<% /* %> ... <% */ %>`) is not understood.
- Only the default delimiters, `<%` and `%>`.
- tree-sitter-embedded-template ends the code of an output tag closed by `_%>` one character late
  ([tree-sitter-embedded-template#46]); the tags have the `_%>` and the code without the `_`.

## License

[Apache-2.0](LICENSE)

[eslint-plugin-ejs-templates]: https://github.com/mshima/eslint-plugin-ejs-templates/tree/main/packages/eslint-plugin-ejs-templates
[tree-sitter-embedded-template]: https://github.com/tree-sitter/tree-sitter-embedded-template
[tree-sitter-embedded-template#46]: https://github.com/tree-sitter/tree-sitter-embedded-template/issues/46
[tree-sitter-javascript]: https://github.com/tree-sitter/tree-sitter-javascript
[web-tree-sitter]: https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web
