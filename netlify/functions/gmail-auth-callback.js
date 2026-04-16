exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return { statusCode: 302, headers: { Location: '/?gmail_auth=error&reason=' + encodeURIComponent(error) }, body: '' };
  }
  if (!code) {
    return { statusCode: 400, body: 'Missing code' };
  }

  try {
    // Exchange code for tokens
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

    // Store refresh token via Netlify API
    const siteId = '839aa6e8-1984-428d-8305-6cb55597be1d';
    const netlifyToken = process.env.NETLIFY_TOKEN;

    const envRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/env/GMAIL_REFRESH_TOKEN`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${netlifyToken}`
      },
      body: JSON.stringify({
        key: 'GMAIL_REFRESH_TOKEN',
        scopes: ['functions', 'runtime'],
        values: [{ value: tokens.refresh_token, context: 'all' }]
      })
    });

    if (!envRes.ok) {
      // Fallback: return token in redirect so app can store it in localStorage
      return {
        statusCode: 302,
        headers: { Location: `/?gmail_auth=success&refresh_token=${encodeURIComponent(tokens.refresh_token)}` },
        body: ''
      };
    }

    return { statusCode: 302, headers: { Location: '/?gmail_auth=success' }, body: '' };
  } catch (err) {
    return { statusCode: 302, headers: { Location: '/?gmail_auth=error&reason=' + encodeURIComponent(err.message) }, body: '' };
  }
};
