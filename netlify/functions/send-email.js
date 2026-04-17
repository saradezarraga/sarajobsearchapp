async function getGmailAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive'
    }).toString()
  });
  const tokens = await res.json();
  if (tokens.error) throw new Error('Failed to refresh token: ' + (tokens.error_description || tokens.error));
  if (!tokens.access_token) throw new Error('No access token in response: ' + JSON.stringify(tokens));
  return tokens.access_token;
}

async function getPdfFromDrive(docxId, accessToken) {
  // Export the docx as PDF using the user's OAuth access token
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docxId}/export?mimeType=application/pdf`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive export failed: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) throw new Error('PDF too small, likely an error response');
  return buffer.toString('base64');
}

function buildMimeEmail({ to, subject, body, pdfBase64, pdfFileName }) {
  const boundary = 'boundary_' + Date.now();
  const lines = [
    `From: Sara de Zarraga <saradezarraga@gmail.com>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    body,
    ``
  ];
  if (pdfBase64 && pdfFileName) {
    lines.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${pdfFileName}"`,
      `Content-Disposition: attachment; filename="${pdfFileName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      pdfBase64,
      ``
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { to, subject, body, docxId, pdfFileName, refreshToken } = JSON.parse(event.body);
    if (!to || !subject || !body) throw new Error('Missing to, subject, or body');

    const token = process.env.GMAIL_REFRESH_TOKEN || refreshToken;
    if (!token) throw new Error('Gmail not connected. Please connect Gmail in Settings first.');

    // Get OAuth access token (used for both Gmail send AND Drive PDF export)
    const accessToken = await getGmailAccessToken(token);

    // Fetch PDF from Drive using the same OAuth token
    let pdfBase64 = null;
    if (docxId) {
      try {
        pdfBase64 = await getPdfFromDrive(docxId, accessToken);
      } catch (e) {
        // Don't send without attachment — throw so user knows
        throw new Error('Could not attach resume PDF: ' + e.message);
      }
    }

    const rawMime = buildMimeEmail({ to, subject, body, pdfBase64, pdfFileName });
    const encoded = Buffer.from(rawMime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
