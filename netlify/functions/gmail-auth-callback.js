const { getStore } = require('@netlify/blobs');
const https = require('https');

function postForm(url, data) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve(raw); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return { statusCode: 302, headers: { Location: '/?gmail_auth=error&reason=' + encodeURIComponent(error) }, body: '' };
  }
  if (!code) {
    return { statusCode: 400, body: 'Missing code' };
  }

  try {
    const tokens = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: 'https://sara-job-search-app.netlify.app/auth/callback',
      grant_type: 'authorization_code'
    });

    if (tokens.error) throw new Error(tokens.error_description || tokens.error);
    if (!tokens.refresh_token) throw new Error('No refresh token returned — ensure prompt=consent was set');

    // Store refresh token in Netlify Blobs
    const store = getStore('gmail-auth');
    await store.set('refresh_token', tokens.refresh_token);

    return { statusCode: 302, headers: { Location: '/?gmail_auth=success' }, body: '' };
  } catch (err) {
    return { statusCode: 302, headers: { Location: '/?gmail_auth=error&reason=' + encodeURIComponent(err.message) }, body: '' };
  }
};
