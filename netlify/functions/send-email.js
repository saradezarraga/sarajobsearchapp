const { google } = require('googleapis');

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
  if (tokens.error) throw new Error('Token refresh failed: ' + (tokens.error_description || tokens.error));
  if (!tokens.access_token) throw new Error('No access token returned');
  return tokens.access_token;
}

async function getPdfBase64(docxId, accessToken) {
  // Get file metadata to check mimeType
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docxId}?fields=mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) throw new Error(`Could not get file metadata: ${metaRes.status}`);
  const meta = await metaRes.json();

  if (meta.mimeType === 'application/vnd.google-apps.document') {
    // Google Doc — export as PDF directly
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docxId}/export?mimeType=application%2Fpdf`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Google Doc PDF export failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('PDF export returned empty data');
    return buf.toString('base64');
  } else {
    // .docx or other binary — download it and convert using service account + Drive import trick
    // Download the raw file
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docxId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!dlRes.ok) throw new Error(`File download failed: ${dlRes.status}`);
    const docxBuf = Buffer.from(await dlRes.arrayBuffer());

    // Upload as Google Doc (conversion), export as PDF, then delete temp file
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
    let creds;
    try { creds = JSON.parse(raw); } catch { creds = JSON.parse(raw.replace(/\\n/g, '\n')); }
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive'] });
    const drive = google.drive({ version: 'v3', auth });

    // Upload docx as Google Doc
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(docxBuf);
    stream.push(null);
    const uploaded = await drive.files.create({
      requestBody: { name: 'temp_conversion', mimeType: 'application/vnd.google-apps.document' },
      media: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: stream },
      fields: 'id'
    });
    const tempId = uploaded.data.id;

    try {
      // Export as PDF
      const pdfRes = await drive.files.export(
        { fileId: tempId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );
      const pdfBuf = Buffer.from(pdfRes.data);
      if (pdfBuf.length < 1000) throw new Error('PDF conversion returned empty data');
      return pdfBuf.toString('base64');
    } finally {
      // Always delete the temp file
      await drive.files.delete({ fileId: tempId }).catch(() => {});
    }
  }
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
    if (!token) throw new Error('Gmail not connected.');

    const accessToken = await getAccessToken(token);

    let pdfBase64 = null;
    if (docxId) {
      pdfBase64 = await getPdfBase64(docxId, accessToken);
    }

    const rawMime = buildMimeEmail({ to, subject, body, pdfBase64, pdfFileName });
    const encoded = Buffer.from(rawMime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
