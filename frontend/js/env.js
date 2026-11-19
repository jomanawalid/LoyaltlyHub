// Local development defaults. On deploy, infra/scripts/08-frontend.sh REPLACES this file
// with the real API URL and Cognito app client id. These values are public, not secrets.
window.LOYALTY_ENV = window.LOYALTY_ENV || {
  apiUrl: 'http://localhost:3000',
  cognitoEndpoint: 'http://localhost:4566',
  cognitoClientId: 'PASTE_COGNITO_CLIENT_ID_FOR_LOCAL_DEV',
};
