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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body);

    // Two modes: rawTemplate (from Settings editor) or drafts (from email step)
    let docContent = '';
    if (body.rawTemplate !== undefined) {
      // Direct template edit from Settings
      docContent = body.rawTemplate;
    } else if (body.drafts && body.drafts.length) {
      // Save approved email drafts as new template baseline
      const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      docContent = `EMAIL TEMPLATES — Last updated: ${now}\n\n`;
      docContent += `Claude uses this as the base language for drafting referral emails. It adapts the contact name, company, role, and relationship for each email.\n\n`;
      docContent += `${'─'.repeat(60)}\n\n`;
      for (const draft of body.drafts) {
        docContent += `TEMPLATE TYPE: ${(draft.label || 'draft').toUpperCase()}\n`;
        if (draft.subject) docContent += `Subject: ${draft.subject}\n\n`;
        docContent += `${draft.edited}\n\n`;
        docContent += `${'─'.repeat(60)}\n\n`;
      }
    } else {
      throw new Error('No template content provided');
    }

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const existing = await drive.files.list({
      q: `name='${TEMPLATE_FILE_NAME}' and '${APP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)'
    });

    if (existing.data.files.length > 0) {
      const fileId = existing.data.files[0].id;
      await drive.files.update({
        fileId,
        media: { mimeType: 'text/plain', body: Buffer.from(docContent, 'utf8') }
      });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, fileId }) };
    } else {
      const created = await drive.files.create({
        requestBody: { name: TEMPLATE_FILE_NAME, parents: [APP_FOLDER_ID], mimeType: 'text/plain' },
        media: { mimeType: 'text/plain', body: Buffer.from(docContent, 'utf8') },
        fields: 'id'
      });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, fileId: created.data.id }) };
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
