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
import { buildTemplate, cleanupTemplate } from 'ejs-template-parser';

const template = buildTemplate(`<%_ for (const field of fields) { _%>
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
  cleanupTemplate(template);
}
```

## API

### `buildTemplate(text)`

Builds the tree of a template. Throws an `EjsSyntaxError` when the template has a syntax error (a
tag left open): an `Error` with the 1-based `line` and `column` of the error, `lineNumber` (the
line, which ESLint reads on an error a processor throws) and its `syntax-error` diagnostic
(`diagnostic`).

Its trees live in WebAssembly memory, which the garbage collector does not manage (see
[Memory](#memory)):

- declared with `const`, as on Node 22, which has no `using`, the template is freed by
  `cleanupTemplate`, called once done with it, in a `finally`:

  ```js
  const template = buildTemplate(text);
  try {
    // ...
  } finally {
    cleanupTemplate(template);
  }
  ```

- declared with `using`, on Node 24 or in code compiled for an older Node, it is freed at the end of
  its block, without `cleanupTemplate`:

  ```js
  {
    using template = buildTemplate(text);
    // ...
  }
  ```

The template built has:

- `text` — the template.
- `children` — the texts, tags and blocks of the template, in order. Together they cover the whole
  template.
- `nodes` — the texts and the tags of the template in order, each tag once: joined, they write the
  template back.
- `tags` — every tag of the template, in order.

### `cleanupTemplate(template)`

Frees the trees of a template `buildTemplate` built; the nodes of its tags are invalid afterwards,
their other fields stay. Called again, it does nothing. A template declared with `using` is cleaned
up at the end of its block.

A node of the tree is one of:

- **`EjsText`** — `{ kind: 'text', offset, length, text, rendered, renderedOffsets }`: a text between
  tags. `text` is as written: the escaped delimiters `<%%` and `%%>` are still there, and so is the
  whitespace the delimiters around the text slurp.
  - `rendered` — what EJS renders of the text, given the tags around it.
  - `renderedOffsets` — the offset in the template of each character of `rendered`, then one more,
    its end: where a text inserted renders after `rendered`, and drops nothing more. It is after the
    last rendered character, and after the blanks a written `_%>` slurps and the line break dropped
    after it, but before the blanks a `<%_` after the text slurps; when nothing
    renders, after what the tag before the text slurps. A character written in place of an escape
    maps to the one it is written from (the `<` and the first `%` of `<%%`, the `%` and the `>` of
    `%%>`), the extra `%` to nothing.

  `rendered` follows EJS 6:
  - the blanks before a `<%_` and after a `_%>` are slurped; after a `-%>` or a `_%>`, the first line
    break (`\r\n`, `\r` or `\n`) of the next text is dropped;
  - `<%%` renders `<%` and `%%>` renders `%>`, each one entering a literal mode in which the next
    close delimiter of the text is written, and ends that mode;
  - a close delimiter in a text outside of that mode (`%>`, `-%>`, `_%>`) is dropped, a `-%>` or a
    `_%>` dropping the line break after it, a `_%>` the blanks after it.

  Joined, the `rendered` of the texts of a template is what EJS renders of it with its tags emptied
  (`<%_ _%>`, `<% -%>`, an output tag an empty code tag with its delimiters).

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

### Diagnostics

`validateTemplate(template)` gives the diagnostics of a template `buildTemplate` built, before
`cleanupTemplate` frees it (they read the JavaScript of its tags): `{ code, severity, message,
offset, length, line, column }` each, in order. A template that does not parse has its diagnostic on
the `EjsSyntaxError` `buildTemplate` throws.

`diagnoseTemplate(text)` gives them in one call: it builds the template, validates it and frees it,
and gives the `syntax-error` diagnostic alone of a template that does not parse, instead of throwing.

```js
import { diagnoseTemplate } from 'ejs-template-parser';

for (const { severity, code, line, message } of diagnoseTemplate(text)) {
  console.log(`${line}: ${severity} ${code}: ${message}`);
}
```

Or, with the template to read further:

```js
import { buildTemplate, cleanupTemplate, EjsSyntaxError, validateTemplate } from 'ejs-template-parser';

const diagnosticsOf = (text) => {
  let template;
  try {
    template = buildTemplate(text);
  } catch (error) {
    if (error instanceof EjsSyntaxError) return [error.diagnostic]; // { code: 'syntax-error', ... }
    throw error;
  }
  try {
    return validateTemplate(template);
  } finally {
    cleanupTemplate(template);
  }
};
```

Errors, what EJS fails on or renders otherwise than written:

- `syntax-error` — the template does not parse, a tag left open (on the `EjsSyntaxError`
  `buildTemplate` throws, given by `diagnoseTemplate`).
- `javascript-error` — the JavaScript EJS compiles the template to does not parse, at this tag. The
  template is compiled as EJS compiles it: its code tags in line, its texts and output tags appended.
- `comment-across-tags` — a block comment opened in a tag and closed in a later one: what is between
  them is commented out.
- `stray-close-delimiter` — a `%>` (or `-%>`, `_%>`) in a text, which EJS drops; `%%>` writes one.

Warnings, what is out of the conventions of [eslint-plugin-ejs-templates], each one named after its
rule:

- `unclosed-block`, `unopened-close` — a block no tag closes, a tag closing a block no tag opens, as
  in a partial template.
- `prefer-slurping-codeonly` — a `<% %>` tag opening no block, which leaves its blanks and its line
  break in the output where `<%_ _%>` slurps them.
- `slurp-newline` — a slurp tag with text before it on its line, whose blanks it slurps.
- `indent` — a slurp tag on a line of its own not indented two blanks for each block it is in.
- `prefer-single-line-tags` — a tag of several statements opening or closing blocks over several
  lines, or one closing several blocks.
- `no-comment-empty-line` — a comment tag on a line of its own not closed by `-%>`, which leaves an
  empty line.

### Lower level

- `getEjsNodes(text)` — the top-level tree-sitter nodes of a template, each with its `linePrefix`;
  throws the `EjsSyntaxError` of a template that does not parse.
- `getEjsTags(nodes)` — the tags of those nodes, each code tag parsed inside the blocks the tags
  before it left open.
- `parseJavaScriptPartial(code, context)` — a best-guess parse of a snippet of JavaScript with
  unbalanced braces: the braces it leaves open (`missingCloseBracesCount`) and the ones it closes
  (`missingOpenBracesCount`), its nodes, and `splitStatements()`.
- `parseEjs(text)`, `parseJavaScript(text)`, `findErrorNode(node)` — the tree-sitter parsers.
- `hasAbsorbedSlurpClose(node)`, `getDirectiveCodeText(node)`, `getCommentCloseDelimiter(text)`,
  `EJS_OPENING_DELIMS`, `EJS_CLOSING_DELIMS` — the delimiters of a tag node.

## Memory

The trees of tree-sitter live in WebAssembly memory, which the JavaScript garbage collector does not
manage: left behind, a few hundred templates exhaust it and abort the process. Free them once done
with a template:

- `cleanupTemplate(template)` for `buildTemplate`, in a `finally`;
- or a `using` declaration, which cleans the template up at the end of its block, whatever ends it
  (Node 24, or a compiler supporting it):

  ```js
  {
    using template = buildTemplate(text);
    // ...
  }
  ```

- for the lower level, `tag.javascript.cleanup()` for each code tag and `nodes[0].tree.delete()` for
  the nodes of `getEjsNodes`.

The fields of a tag other than its `node` and `javascript` stay valid afterwards.

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
