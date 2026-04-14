/**
 * Fixture 4 – prefer-single-line-tags (porting ejsCollapseMultiline).
 *
 * Input contains multiline EJS tags in several forms.
 * Expected output collapses only structural slurp tags.
 * Non-structural multiline tags remain unchanged.
 */

export const input = `<%_
if (generateSpringAuditor) {
_%>
<%_
  const x = 1;
  const y = 2;
_%>
<%
  doSomething();
%>
<h1><%=
  title
%></h1>
<%_ } _%>
`;

export const expected = `<%_ if (generateSpringAuditor) { _%>
<%_
  const x = 1;
  const y = 2;
_%>
<% doSomething(); %>
<h1><%- title %></h1>
<%_ } _%>
`;

export const rules = {
  'ejs-templates/prefer-single-line-tags': 'error' as const,
  'ejs-templates/prefer-encoded': ['error', 'never'] as ['error', 'never'],
};
