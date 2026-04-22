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
  // Check file type
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docxId}?fields=mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) throw new Error(`Metadata fetch failed: ${metaRes.status}`);
  const { mimeType } = await metaRes.json();

  if (mimeType === 'application/vnd.google-apps.document') {
    // Already a Google Doc — export directly
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docxId}/export?mimeType=application%2Fpdf`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Export failed: ${res.status} ${await res.text()}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('PDF export returned empty data');
    return buf.toString('base64');
  }

  // .docx — download, upload as Google Doc (using user's OAuth = user's quota), export PDF, delete
  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docxId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
  const docxBuf = await dlRes.arrayBuffer();

  // Upload as Google Doc using multipart upload with user's OAuth token
  const boundary = 'upload_boundary_' + Date.now();
  const metadata = JSON.stringify({ name: '_temp_pdf_conversion', mimeType: 'application/vnd.google-apps.document' });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
    Buffer.from(docxBuf),
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
        'Content-Length': body.length.toString()
      },
      body
    }
  );
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const { id: tempId } = await uploadRes.json();

  try {
    const pdfRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${tempId}/export?mimeType=application%2Fpdf`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!pdfRes.ok) throw new Error(`PDF export of temp file failed: ${pdfRes.status}`);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    if (pdfBuf.length < 1000) throw new Error('PDF conversion returned empty data');
    return pdfBuf.toString('base64');
  } finally {
    await fetch(`https://www.googleapis.com/drive/v3/files/${tempId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    }).catch(() => {});
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
