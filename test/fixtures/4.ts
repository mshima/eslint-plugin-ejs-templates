/**
 * Fixture 4 – no-multiline-tags (porting ejsCollapseMultiline).
 *
 * Input contains multiline EJS tags in several forms.
 * Expected output has all non-empty content lines joined into a single tag.
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
`;

export const expected = `<%_ if (generateSpringAuditor) { _%>
<%_ const x = 1; const y = 2; _%>
<% doSomething(); %>
<h1><%- title %></h1>
`;

export const rules = {
  'templates/no-multiline-tags': 'error' as const,
  'templates/prefer-raw': 'error' as const,
};
