export const options = {
  ejsIndent: true,
};

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

export const expected = `  "devDependencies": {
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
