export const options = {
  ejsIndent: true,
};

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
