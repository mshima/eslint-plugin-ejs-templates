// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/** What the tests use of EJS, which ships no types. */
declare module 'ejs' {
  /**
   * A template as EJS compiles it: `generateSource()` appends the code of the template function to `source`, a chunk
   * for each text and tag, in the `mode` of the tag it is in.
   */
  type Template = {
    mode: 'eval' | 'escaped' | 'raw' | 'comment' | 'literal' | null;
    source: string;
    generateSource(): void;
  };
  const ejs: {
    render: (template: string, data?: Record<string, unknown>, options?: Record<string, unknown>) => string;
    compile: (template: string, options?: Record<string, unknown>) => (data?: Record<string, unknown>) => string;
    Template: new (template: string, options?: Record<string, unknown>) => Template;
  };
  export default ejs;
}
