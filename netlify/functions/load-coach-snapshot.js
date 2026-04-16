const { google } = require('googleapis');

const APP_FOLDER_ID = '1koBBe1Th7qmD2AAF3eljwNor8gPYcl5f';
const SNAPSHOT_FILE_NAME = 'coach-snapshot.json';

async function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  let creds;
  try { creds = JSON.parse(raw); } catch {
    creds = JSON.parse(raw.replace(/\\n/g, '\n'));
  }
  return new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.list({
      q: `name='${SNAPSHOT_FILE_NAME}' and '${APP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)'
    });

    if (!res.data.files.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ jobs: [], updatedAt: null }) };
    }

    const file = await drive.files.get(
      { fileId: res.data.files[0].id, alt: 'media' },
      { responseType: 'text' }
    );

    return { statusCode: 200, headers, body: typeof file.data === 'string' ? file.data : JSON.stringify(file.data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
