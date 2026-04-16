async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token'
    }).toString()
  });
  const tokens = await res.json();
  if (tokens.error) throw new Error('Failed to refresh token: ' + (tokens.error_description || tokens.error));
  return tokens.access_token;
}

async function getPdfFromDrive(docxId) {
  // Use service account to export the docx as PDF from Drive
  const { google } = require('googleapis');
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  let creds;
  try { creds = JSON.parse(raw); } catch {
    creds = JSON.parse(raw.replace(/\\n/g, '\n'));
  }
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.export(
    { fileId: docxId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data).toString('base64');
}

function buildMimeEmail({ to, subject, body, pdfBase64, pdfFileName }) {
  const boundary = 'boundary_' + Date.now();
  const lines = [
    `From: Sara de Zárraga <saradezarraga@gmail.com>`,
    `To: ${to}`,
    `Subject: ${subject}`,
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

    const accessToken = await getAccessToken(token);

    // Fetch PDF from Drive on demand (avoids passing large base64 in requests)
    let pdfBase64 = null;
    if (docxId) {
      try { pdfBase64 = await getPdfFromDrive(docxId); } catch (e) {
        console.error('PDF fetch failed, sending without attachment:', e.message);
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
