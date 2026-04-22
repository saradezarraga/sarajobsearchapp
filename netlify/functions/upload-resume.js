const { google } = require('googleapis');
const { Readable } = require('stream');

const APP_FOLDER_ID = '1koBBe1Th7qmD2AAF3eljwNor8gPYcl5f';
const RESUMES_FOLDER_ID = '1PnkZTP8NaTrekPiseZm_JJfUR37CuxSY';

async function getUserAccessToken(refreshToken) {
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
  return tokens.access_token;
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
    const { docxBase64, company, role, refreshToken } = JSON.parse(event.body);
    if (!docxBase64) throw new Error('Missing docxBase64');
    if (!company || !role) throw new Error('Missing company or role');
    if (!refreshToken) throw new Error('Gmail not connected — no refresh token');

    const accessToken = await getUserAccessToken(refreshToken);
    const docxBuf = Buffer.from(docxBase64, 'base64');

    const fileName = `SaradeZarraga-${company.replace(/[^a-zA-Z0-9]/g, '')}-${role.replace(/[^a-zA-Z0-9]/g, '-')}`;

    // Upload as Google Doc via multipart upload with user's OAuth token (user's quota)
    const boundary = 'upload_boundary_' + Date.now();
    const metadata = JSON.stringify({
      name: fileName,
      mimeType: 'application/vnd.google-apps.document',
      parents: [RESUMES_FOLDER_ID]
    });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
      docxBuf,
      Buffer.from(`\r\n--${boundary}--`)
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
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

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Drive upload failed: ${uploadRes.status} ${errText}`);
    }

    const uploaded = await uploadRes.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        docxId: uploaded.id,
        docxUrl: uploaded.webViewLink || `https://docs.google.com/document/d/${uploaded.id}/edit`,
        fileName: fileName + '.docx'
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
