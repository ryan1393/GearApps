describe('blade-tracking', () => {
  it('redirects an unauthenticated user to login', () => {
    cy.visit('/');

    cy.url().should('include', '/login');
    cy.contains('Sign in to your account').should('be.visible');
  });
});
