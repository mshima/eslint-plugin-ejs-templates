/**
 * Fixture 3 – prefer-raw and prefer-slurping rules.
 * Input contains `<%= %>` (should use `<%-`) and `<% %>` (should use `<%_ _%>`) violations.
 * Expected output has both types of violations fixed.
 */

/** Input with incorrect delimiters (violations). */
export const input = `<h1><%= title %></h1>
<p><%= description %></p>
<% const cssClass = active ? 'active' : ''; %>
<div class="<%= cssClass %>">content</div>
`;

/** Expected output after applying `prefer-raw` and `prefer-slurping` autofixes. */
export const expected = `<h1><%- title %></h1>
<p><%- description %></p>
<%_ const cssClass = active ? 'active' : ''; _%>
<div class="<%- cssClass %>">content</div>
`;
