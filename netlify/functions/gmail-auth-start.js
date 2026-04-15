exports.handler = async () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = 'https://sara-job-search-app.netlify.app/auth/callback';
  const scope = 'https://www.googleapis.com/auth/gmail.send';

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  return {
    statusCode: 302,
    headers: { Location: url },
    body: ''
  };
};
