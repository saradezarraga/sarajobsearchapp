const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return {
      statusCode: 302,
      headers: { Location: '/?gmail_auth=error&reason=' + encodeURIComponent(error) },
      body: ''
    };
  }
  if (!code) {
    return { statusCode: 400, body: 'Missing code' };
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: 'https://sara-job-search-app.netlify.app/auth/callback',
        grant_type: 'authorization_code'
      }).toString()
    });

    const tokens = await res.json();

    if (tokens.error) throw new Error(tokens.error_description || tokens.error);
    if (!tokens.refresh_token) throw new Error('No refresh token returned');

    const store = getStore('gmail-auth');
    await store.set('refresh_token', tokens.refresh_token);

    return {
      statusCode: 302,
      headers: { Location: '/?gmail_auth=success' },
      body: ''
    };
  } catch (err) {
    return {
      statusCode: 302,
      headers: { Location: '/?gmail_auth=error&reason=' + encodeURIComponent(err.message) },
      body: ''
    };
  }
};
