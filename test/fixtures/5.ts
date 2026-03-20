/**
 * Fixture 5 – ejs-indent (porting ejsIndent).
 *
 * Input has standalone <%_ _%> tags with incorrect (or absent) brace-depth
 * indentation.  Expected output has each tag indented by `brace-depth × 2` spaces.
 */

export const input = `<%_ if (skipServer) { _%>
<%_ doWork(); _%>
<%_ } _%>
<%_ if (microfrontend) { _%>
<%_ if (applicationTypeGateway) { _%>
<%_ doInner(); _%>
<%_ } _%>
<%_ } _%>
`;

export const expected = `<%_ if (skipServer) { _%>
  <%_ doWork(); _%>
<%_ } _%>
<%_ if (microfrontend) { _%>
  <%_ if (applicationTypeGateway) { _%>
    <%_ doInner(); _%>
  <%_ } _%>
<%_ } _%>
`;

export const rules = {
  'templates/ejs-indent': 'error' as const,
};
