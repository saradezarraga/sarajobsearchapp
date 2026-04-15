const { google } = require('googleapis');

async function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT not set');
  let creds;
  try { creds = JSON.parse(raw); } catch {
    try { creds = JSON.parse(raw.replace(/\\n/g, '\n')); } catch (e) {
      throw new Error('Failed to parse: ' + e.message);
    }
  }
  return new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/gmail.send'] });
}

function buildMimeEmail({ to, subject, body, pdfBase64, pdfFileName, fromName }) {
  const boundary = 'boundary_' + Date.now();
  const fromEmail = 'saradezarraga@gmail.com';

  let mime = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    body,
    ``
  ];

  if (pdfBase64 && pdfFileName) {
    mime = mime.concat([
      `--${boundary}`,
      `Content-Type: application/pdf; name="${pdfFileName}"`,
      `Content-Disposition: attachment; filename="${pdfFileName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      pdfBase64,
      ``
    ]);
  }

  mime.push(`--${boundary}--`);
  return mime.join('\r\n');
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
    const { to, subject, body, pdfBase64, pdfFileName } = JSON.parse(event.body);
    if (!to || !subject || !body) throw new Error('Missing to, subject, or body');

    const auth = await getGoogleAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    const rawMime = buildMimeEmail({
      to, subject, body,
      pdfBase64: pdfBase64 || null,
      pdfFileName: pdfFileName || null,
      fromName: 'Sara de Zárraga'
    });

    const encoded = Buffer.from(rawMime).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
