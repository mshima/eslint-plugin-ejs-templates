/**
 * Fixture 4 – no-multiline-tags (porting ejsCollapseMultiline).
 *
 * Input contains multiline EJS tags in several forms.
 * Expected output has each tag collapsed to one line, or split into multiple
 * single-line tags (one per non-empty content line).
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
<%_ const x = 1; _%>
<%_ const y = 2; _%>
<% doSomething(); %>
<h1><%- title %></h1>
`;

export const rules = {
  'templates/no-multiline-tags': 'error' as const,
  'templates/prefer-raw': 'error' as const,
};
