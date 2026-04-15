const { google } = require('googleapis');
const JSZip = require('jszip');
const { Readable } = require('stream');

const APP_FOLDER_ID = '1koBBe1Th7qmD2AAF3eljwNor8gPYcl5f';
const MASTER_RESUME_ID = '1Wt72BdV8NPrbE_lYHVGQGQwq3fzN6Ixh';

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

async function findOrCreateFolder(drive, name, parentId) {
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)'
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id'
  });
  return folder.data.id;
}

function parseTailoredSections(text) {
  const result = { headline: '', accomplishments: [] };
  const headlineMatch = text.match(/HEADLINE:\s*\n([\s\S]*?)(?=\nACCOMPLISHMENTS:|$)/i);
  if (headlineMatch) result.headline = headlineMatch[1].trim();
  const accMatch = text.match(/ACCOMPLISHMENTS:\s*\n([\s\S]*?)$/i);
  if (accMatch) {
    const items = accMatch[1].trim().split(/\n(?=\d+\.)/);
    for (const item of items) {
      const m = item.match(/^\d+\.\s*([^:]+):\s*([\s\S]*)/);
      if (m) result.accomplishments.push({ title: m[1].trim(), body: m[2].trim().replace(/\n/g, ' ') });
    }
  }
  return result;
}

function escXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Build a single Word paragraph XML, copying pPr/rPr from a sample paragraph
function buildParagraph(text, sampleXml, italic = false) {
  const pPr = sampleXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
  let rPr = sampleXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
  if (italic && rPr) {
    rPr = rPr.replace('</w:rPr>', '<w:i/><w:iCs/></w:rPr>');
  } else if (italic) {
    rPr = '<w:rPr><w:i/><w:iCs/></w:rPr>';
  }
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
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
    const { resumeText, company, role } = JSON.parse(event.body);
    if (!resumeText) throw new Error('No resume text provided');

    const { headline, accomplishments } = parseTailoredSections(resumeText);
    if (!headline) throw new Error('Could not parse HEADLINE from resume text. Raw text starts with: ' + resumeText.substring(0, 100));
    if (!accomplishments.length) throw new Error('Could not parse ACCOMPLISHMENTS from resume text');

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Download master Word doc as binary
    const docRes = await drive.files.get(
      { fileId: MASTER_RESUME_ID, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const docBuffer = Buffer.from(docRes.data);
    if (!docBuffer.length) throw new Error('Master resume download returned empty buffer');

    // Unzip the docx
    const zip = await JSZip.loadAsync(docBuffer);
    let xml = await zip.file('word/document.xml').async('string');

    // ── Find key section markers ─────────────────────────────────────
    // Find all paragraphs as array with index info
    const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
    let allParas = [];
    let m;
    while ((m = paraRegex.exec(xml)) !== null) {
      allParas.push({ xml: m[0], index: m.index, end: m.index + m[0].length });
    }

    // Find RELEVANT ACCOMPLISHMENTS paragraph index
    const relAccIdx = allParas.findIndex(p => p.xml.replace(/<[^>]+>/g, '').includes('RELEVANT ACCOMPLISHMENTS'));
    if (relAccIdx === -1) throw new Error('Could not find RELEVANT ACCOMPLISHMENTS section in document XML');

    // Find EMPLOYMENT HISTORY paragraph index
    const empHistIdx = allParas.findIndex(p => p.xml.replace(/<[^>]+>/g, '').includes('EMPLOYMENT HISTORY'));
    if (empHistIdx === -1) throw new Error('Could not find EMPLOYMENT HISTORY section in document XML');

    // Headline: last paragraph before RELEVANT ACCOMPLISHMENTS with substantial text (>50 chars)
    let headlineParaIdx = -1;
    for (let i = relAccIdx - 1; i >= 0; i--) {
      const text = allParas[i].xml.replace(/<[^>]+>/g, '').trim();
      if (text.length > 50) { headlineParaIdx = i; break; }
    }
    if (headlineParaIdx === -1) throw new Error('Could not find headline paragraph');

    // ── Replace headline ─────────────────────────────────────────────
    const headlineSample = allParas[headlineParaIdx];
    const newHeadlinePara = buildParagraph(headline, headlineSample.xml, false);

    // ── Build new accomplishments XML ────────────────────────────────
    // Use first accomplishment paragraph as formatting sample
    const accSample = allParas[relAccIdx + 1] || allParas[relAccIdx];
    let newAccXml = '';
    for (const acc of accomplishments) {
      // Title in italic + body in normal — same paragraph, two runs
      const pPr = accSample.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
      let rPr = accSample.xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
      const rPrItalic = rPr
        ? rPr.replace('</w:rPr>', '<w:i/><w:iCs/></w:rPr>')
        : '<w:rPr><w:i/><w:iCs/></w:rPr>';

      newAccXml += `<w:p>${pPr}` +
        `<w:r>${rPrItalic}<w:t xml:space="preserve">${escXml(acc.title)}: </w:t></w:r>` +
        `<w:r>${rPr}<w:t xml:space="preserve">${escXml(acc.body)}</w:t></w:r>` +
        `</w:p>`;
    }

    // ── Apply changes to XML string ──────────────────────────────────
    // Work backwards so indices stay valid: accomplishments first, then headline

    // Replace accomplishments: everything between relAcc para end and empHist para start
    const accBlockStart = allParas[relAccIdx].end;
    const accBlockEnd = allParas[empHistIdx].index;
    xml = xml.substring(0, accBlockStart) + newAccXml + xml.substring(accBlockEnd);

    // Re-parse to get fresh indices after acc replacement
    allParas = [];
    const paraRegex2 = /<w:p[ >][\s\S]*?<\/w:p>/g;
    while ((m = paraRegex2.exec(xml)) !== null) {
      allParas.push({ xml: m[0], index: m.index, end: m.index + m[0].length });
    }
    const newRelAccIdx = allParas.findIndex(p => p.xml.replace(/<[^>]+>/g, '').includes('RELEVANT ACCOMPLISHMENTS'));
    let newHeadlineParaIdx = -1;
    for (let i = newRelAccIdx - 1; i >= 0; i--) {
      const text = allParas[i].xml.replace(/<[^>]+>/g, '').trim();
      if (text.length > 50) { newHeadlineParaIdx = i; break; }
    }

    if (newHeadlineParaIdx >= 0) {
      const hp = allParas[newHeadlineParaIdx];
      xml = xml.substring(0, hp.index) + newHeadlinePara + xml.substring(hp.end);
    }

    // Repack zip
    zip.file('word/document.xml', xml);
    const newDocBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    // Upload to Resumes folder
    const resumesFolderId = await findOrCreateFolder(drive, 'Resumes', APP_FOLDER_ID);
    const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const fileName = `${company} — ${role} — ${monthYear}`;

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName + '.docx',
        parents: [resumesFolderId],
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: Readable.from(newDocBuffer)
      },
      fields: 'id, webViewLink'
    });

    const docxId = uploaded.data.id;
    const docxUrl = uploaded.data.webViewLink;

    // Export PDF via Google Drive
    const pdfRes = await drive.files.export(
      { fileId: docxId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    const pdfBuffer = Buffer.from(pdfRes.data);

    const pdfUploaded = await drive.files.create({
      requestBody: {
        name: fileName + '.pdf',
        parents: [resumesFolderId],
        mimeType: 'application/pdf'
      },
      media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
      fields: 'id, webViewLink'
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        docxId, docxUrl,
        pdfId: pdfUploaded.data.id,
        pdfUrl: pdfUploaded.data.webViewLink,
        pdfBase64: pdfBuffer.toString('base64'),
        fileName
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
