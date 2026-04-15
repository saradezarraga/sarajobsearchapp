const { google } = require('googleapis');

const APP_FOLDER_ID = '1koBBe1Th7qmD2AAF3eljwNor8gPYcl5f';
const TEMPLATE_FILE_NAME = 'Email Templates';

async function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT not set');
  let creds;
  try { creds = JSON.parse(raw); } catch {
    try { creds = JSON.parse(raw.replace(/\\n/g, '\n')); } catch (e) {
      throw new Error('Failed to parse service account: ' + e.message);
    }
  }
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.list({
      q: `name='${TEMPLATE_FILE_NAME}' and '${APP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)'
    });

    if (!res.data.files.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ content: null }) };
    }

    const fileId = res.data.files[0].id;
    const exported = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content: exported.data })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content: null })
    };
  }
};
