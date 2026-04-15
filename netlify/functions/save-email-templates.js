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
    scopes: ['https://www.googleapis.com/auth/drive']
  });
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
    const { drafts } = JSON.parse(event.body);
    if (!drafts || !drafts.length) throw new Error('No drafts provided');

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Build plain text content for the template doc
    const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    let docContent = `EMAIL TEMPLATES\nLast updated: ${now}\n\n`;
    docContent += `These are Sara's approved email templates. Future emails should use this language as a base and adapt the contact name, company, and role.\n\n`;
    docContent += `${'─'.repeat(60)}\n\n`;

    for (const draft of drafts) {
      docContent += `TEMPLATE: ${draft.label.toUpperCase()}\n`;
      docContent += `Subject: ${draft.subject}\n\n`;
      docContent += `${draft.edited}\n\n`;
      docContent += `${'─'.repeat(60)}\n\n`;
    }

    // Check if template file already exists
    const existing = await drive.files.list({
      q: `name='${TEMPLATE_FILE_NAME}' and '${APP_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id)'
    });

    const { Readable } = require('stream');
    const mimeType = 'text/plain';

    if (existing.data.files.length > 0) {
      // Update existing file
      const fileId = existing.data.files[0].id;
      await drive.files.update({
        fileId,
        media: {
          mimeType,
          body: Readable.from(Buffer.from(docContent, 'utf8'))
        }
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, fileId })
      };
    } else {
      // Create new file
      const created = await drive.files.create({
        requestBody: {
          name: TEMPLATE_FILE_NAME,
          parents: [APP_FOLDER_ID],
          mimeType: 'application/vnd.google-apps.document'
        },
        media: {
          mimeType,
          body: Readable.from(Buffer.from(docContent, 'utf8'))
        },
        fields: 'id, webViewLink'
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, fileId: created.data.id, url: created.data.webViewLink })
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
