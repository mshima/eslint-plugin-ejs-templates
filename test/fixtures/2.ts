/**
 * Real-world EJS template fixture 2.
 * All tags already use correct delimiters (`<%-`, `<%_`, `_%>`).
 * No violations expected with `prefer-raw` or `prefer-slurping` rules.
 * `input` and `expected` are identical (idempotency: already formatted).
 */
export const input = `  "devDependencies": {
<%_ if (skipServer) { _%>
    "sonar-scanner": "3.1.0",
<%_ } _%>
<%_ if (microfrontend) { _%>
  <%_ if (applicationTypeGateway) { _%>
    "@angular-architects/module-federation-runtime": "<%- nodeDependencies['@angular-architects/module-federation-runtime'] %>",
  <%_ } _%>
    "@angular-architects/module-federation": "<%- nodeDependencies['@angular-architects/module-federation'] %>",
<%_ } _%>
`;

export const expected = input;
