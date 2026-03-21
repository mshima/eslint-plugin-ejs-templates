/**
 * Real-world EJS template fixture 1.
 * All tags already use correct delimiters (`<%-`, `<%_`, `_%>`).
 * No violations expected with `prefer-raw` or `prefer-slurping` rules.
 */
export const input = `  {
    path: '<%- applicationTypeMicroservice ? lowercaseBaseName : '' %>',
    loadChildren: () => import('./entities/entity.routes'),
  },
<%_ if (applicationTypeGateway && microfrontend) { _%>
  <%_ for (const remote of microfrontends) { _%>
  {
    path: '<%- remote.lowercaseBaseName %>',
    loadChildren: () => loadEntityRoutes('<%- remote.lowercaseBaseName %>'),
  },
  <%_ } _%>
<%_ } _%>
`;
