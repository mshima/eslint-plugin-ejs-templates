// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/** Node types emitted by the tree-sitter-embedded-template grammar. */
export type EjsDirectiveType = 'directive' | 'output_directive' | 'comment_directive' | 'graphql_directive';

export type EjsNodeType = EjsDirectiveType | 'content';

/** A text segment between EJS tags. */
export interface EjsTextNode {
  type: 'content';
  value: string;
  start: number;
  end: number;
}

/** A single EJS tag (`<% … %>`, `<%= … %>`, etc.). */
export interface EjsTagNode {
  type: EjsDirectiveType;
  /** Opening delimiter, e.g. `<%`, `<%_`, `<%=`, `<%-`, `<%#`. */
  open: string;
  /** Raw code/content between the delimiters. */
  content: string;
  /** Closing delimiter, e.g. `%>`, `_%>`, `-%>`. */
  close: string;
  start: number;
  end: number;
}

export type EjsChildNode = EjsTextNode | EjsTagNode;

/** Root node of the EJS AST returned by the parser. */
export interface EjsRootNode {
  type: 'root';
  children: EjsChildNode[];
  start: 0;
  end: number;
}

/**
 * Options passed to {@link formatTag}.
 */
export interface FormatTagOptions {
  /** When `true`, `<%=` is converted to `<%-`. */
  preferRaw: boolean;
  /**
   * When `true`, multiline EJS tags are split into separate single-line tags,
   * one per non-empty line.  When `false`, the tag content is trimmed only
   * when the trimmed result is a single line; multiline content is preserved.
   */
  collapseMultiline: boolean;
  /**
   * When `true`, `<% … %>` script tags are converted to `<%_ … _%>`
   * (whitespace-slurping) tags.
   */
  preferSlurping: boolean;
  /**
   * Indentation string for the open tag.  When the tag content is multiline
   * and `collapseMultiline` is `false`, the close delimiter is placed on its
   * own line preceded by this string so that it aligns with the open tag.
   */
  indent?: string;
}

/**
 * Plugin-specific Prettier options.
 *
 * @see {@link https://prettier.io/docs/en/plugins.html#options}
 */
export interface EjsPluginOptions {
  /**
   * Controls whether `<%=` (HTML-escaped output) is converted to `<%-` (raw
   * output).
   *
   * - `'always'`  – always prefer `<%-`
   * - `'never'`   – never convert `<%=` to `<%-`
   * - `'auto'`    – convert unless the file ends with `.html.ejs`
   */
  ejsPreferRaw: 'always' | 'never' | 'auto';

  /**
   * When `true`, each non-empty line of a multiline EJS tag becomes its own
   * single-line tag.  When `false`, the tag content is trimmed only when the
   * trimmed result is a single line; multiline content is preserved.
   */
  ejsCollapseMultiline: boolean;

  /**
   * When `true`, plain `<% … %>` script tags are converted to the
   * whitespace-slurping form `<%_ … _%>`.
   */
  ejsPreferSlurping: boolean;

  /**
   * When `true`, brace-depth indentation is applied to standalone
   * whitespace-slurping (`<%_ … _%>`) tags.  Leading whitespace before such
   * tags is stripped and replaced by printer-controlled indentation.
   *
   * When `false` (the default), no indentation is added or removed, so
   * formatting a file that uses no other options leaves it unchanged.
   */
  ejsIndent: boolean;
}
