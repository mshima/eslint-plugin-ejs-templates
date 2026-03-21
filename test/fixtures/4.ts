/**
 * Fixture 4 – no-multiline-tags (porting ejsCollapseMultiline).
 *
 * Input contains multiline EJS tags in several forms.
 * Expected output collapses each tag to single-line tag(s):
 * - single-phrase content → one tag
 * - multi-phrase content (multiple logical lines) → one tag per phrase
 * - dot-continuation lines are joined to the preceding phrase before splitting
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
  'ejs-templates/no-multiline-tags': 'error' as const,
  'ejs-templates/prefer-raw': 'error' as const,
};
