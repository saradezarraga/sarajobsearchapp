const { google } = require('googleapis');

const APP_FOLDER_ID = '1koBBe1Th7qmD2AAF3eljwNor8gPYcl5f';
const SNAPSHOT_FILE_NAME = 'coach-snapshot.json';

async function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  let creds;
  try { creds = JSON.parse(raw); } catch {
    creds = JSON.parse(raw.replace(/\\n/g, '\n'));
  }
  return new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive'] });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { jobs } = JSON.parse(event.body);

    // Strip sensitive data before saving
    const safeJobs = (jobs || []).map(j => ({
      id: j.id,
      company: j.company,
      role: j.role,
      date: j.date,
      status: j.status,
      driveDocxUrl: j.driveDocxUrl || null,
      contacts: (j.contacts || []).map(c => ({
        name: c.name,
        title: c.title,
        status: c.status,
        sentAt: c.sentAt || null
      }))
    }));

    const snapshot = { jobs: safeJobs, updatedAt: new Date().toISOString() };
    const content = JSON.stringify(snapshot);

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const existing = await drive.files.list({
      q: `name='${SNAPSHOT_FILE_NAME}' and '${APP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)'
    });

    if (existing.data.files.length > 0) {
      await drive.files.update({
        fileId: existing.data.files[0].id,
        media: { mimeType: 'application/json', body: Buffer.from(content) }
      });
    } else {
      await drive.files.create({
        requestBody: { name: SNAPSHOT_FILE_NAME, parents: [APP_FOLDER_ID], mimeType: 'application/json' },
        media: { mimeType: 'application/json', body: Buffer.from(content) },
        fields: 'id'
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
