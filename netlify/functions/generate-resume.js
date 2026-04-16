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

// Flexible parser — handles HEADLINE:, Headline Summary, ## Headline Summary, etc.
function parseTailoredSections(text) {
  const result = { headline: '', accomplishments: [] };

  const headlineMatch = text.match(
    /(?:HEADLINE:|Headline Summary:?|##\s*Headline Summary)\s*\n([\s\S]*?)(?=\n(?:ACCOMPLISHMENTS:|Relevant Accomplishments:?|##\s*Relevant|\d+\.)|$)/i
  );
  if (headlineMatch) result.headline = headlineMatch[1].trim();

  const accMatch = text.match(
    /(?:ACCOMPLISHMENTS:|Relevant Accomplishments:?|##\s*Relevant Accomplishments)\s*\n([\s\S]*?)$/i
  );
  if (accMatch) {
    const items = accMatch[1].trim().split(/\n(?=\d+\.)/);
    for (const item of items) {
      const m = item.match(/^\d+\.\s*(?:\*([^*]+)\*|([^:]+)):\s*([\s\S]*)/);
      if (m) result.accomplishments.push({
        title: (m[1] || m[2] || '').trim(),
        body: m[3].trim().replace(/\n/g, ' ')
      });
    }
  }
  return result;
}

function escXml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripXml(x) {
  return x.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseParas(xml) {
  const paras = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    paras.push({ xml: m[0], index: m.index, end: m.index + m[0].length });
  }
  return paras;
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
    if (!headline) throw new Error('Could not parse headline. Text starts with: ' + resumeText.substring(0, 120));
    if (!accomplishments.length) throw new Error('Could not parse accomplishments. Text: ' + resumeText.substring(0, 200));

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Download master Word doc
    const docRes = await drive.files.get(
      { fileId: MASTER_RESUME_ID, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const docBuffer = Buffer.from(docRes.data);
    if (!docBuffer.length) throw new Error('Master resume download returned empty buffer');

    const zip = await JSZip.loadAsync(docBuffer);
    let xml = await zip.file('word/document.xml').async('string');

    // ── Find section markers ─────────────────────────────────────────
    let allParas = parseParas(xml);

    const relAccIdx = allParas.findIndex(p => {
      const t = stripXml(p.xml).toUpperCase();
      return t.includes('RELEVANT') && t.includes('ACCOMPLISHMENTS');
    });
    if (relAccIdx === -1) {
      const sample = allParas.slice(0, 25).map(p => stripXml(p.xml).substring(0, 50)).join(' | ');
      throw new Error('Could not find RELEVANT ACCOMPLISHMENTS. Paragraphs: ' + sample);
    }

    const empHistIdx = allParas.findIndex(p => {
      const t = stripXml(p.xml).toUpperCase();
      return t.includes('EMPLOYMENT') && t.includes('HISTORY');
    });
    if (empHistIdx === -1) throw new Error('Could not find EMPLOYMENT HISTORY');

    // Sanity check: accomplishments must be between relAcc and empHist
    if (empHistIdx <= relAccIdx) throw new Error(
      `Section order wrong: EMPLOYMENT HISTORY (${empHistIdx}) before RELEVANT ACCOMPLISHMENTS (${relAccIdx})`
    );

    // Find headline paragraph: last paragraph before RELEVANT ACCOMPLISHMENTS with >50 chars
    let headlineParaIdx = -1;
    for (let i = relAccIdx - 1; i >= 0; i--) {
      if (stripXml(allParas[i].xml).length > 50) { headlineParaIdx = i; break; }
    }
    if (headlineParaIdx === -1) throw new Error('Could not find headline paragraph');

    // ── Build replacement XML ────────────────────────────────────────
    // Headline paragraph — copy formatting from original
    const headlineSample = allParas[headlineParaIdx];
    const pPrH = headlineSample.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
    const rPrH = headlineSample.xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const newHeadlinePara = `<w:p>${pPrH}<w:r>${rPrH}<w:t xml:space="preserve">${escXml(headline)}</w:t></w:r></w:p>`;

    // Accomplishment paragraphs — copy formatting from first accomplishment paragraph
    const accSample = allParas[relAccIdx + 1] || allParas[relAccIdx];
    const pPrA = accSample.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
    const rPrA = accSample.xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const rPrAItalic = rPrA
      ? rPrA.replace('</w:rPr>', '<w:i/><w:iCs/></w:rPr>')
      : '<w:rPr><w:i/><w:iCs/></w:rPr>';

    let newAccXml = '';
    for (const acc of accomplishments) {
      newAccXml += `<w:p>${pPrA}` +
        `<w:r>${rPrAItalic}<w:t xml:space="preserve">${escXml(acc.title)}: </w:t></w:r>` +
        `<w:r>${rPrA}<w:t xml:space="preserve">${escXml(acc.body)}</w:t></w:r>` +
        `</w:p>`;
    }

    // ── Apply replacements — accomplishments first (furthest back), then headline ──
    const accBlockStart = allParas[relAccIdx].end;
    const accBlockEnd = allParas[empHistIdx].index;
    xml = xml.substring(0, accBlockStart) + newAccXml + xml.substring(accBlockEnd);

    // Re-parse with fresh indices to replace headline
    allParas = parseParas(xml);
    const newRelAccIdx = allParas.findIndex(p => {
      const t = stripXml(p.xml).toUpperCase();
      return t.includes('RELEVANT') && t.includes('ACCOMPLISHMENTS');
    });
    if (newRelAccIdx >= 0) {
      let newHeadlineIdx = -1;
      for (let i = newRelAccIdx - 1; i >= 0; i--) {
        if (stripXml(allParas[i].xml).length > 50) { newHeadlineIdx = i; break; }
      }
      if (newHeadlineIdx >= 0) {
        const hp = allParas[newHeadlineIdx];
        xml = xml.substring(0, hp.index) + newHeadlinePara + xml.substring(hp.end);
      }
    }

    // Repack zip
    zip.file('word/document.xml', xml);
    const newDocBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    // ── Save to Drive ────────────────────────────────────────────────
    const resumesFolderId = await findOrCreateFolder(drive, 'Resumes', APP_FOLDER_ID);
    const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const fileName = `${company} — ${role} — ${monthYear}`;

    // Copy master (uses owner's quota, not service account's)
    const copied = await drive.files.copy({
      fileId: MASTER_RESUME_ID,
      requestBody: { name: fileName + '.docx', parents: [resumesFolderId] },
      fields: 'id, webViewLink'
    });
    const docxId = copied.data.id;

    // Update copy with edited content — pass Buffer directly, not a stream
    await drive.files.update({
      fileId: docxId,
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: newDocBuffer  // Buffer directly — more reliable than Readable.from()
      }
    });

    const docxMeta = await drive.files.get({ fileId: docxId, fields: 'webViewLink' });
    const docxUrl = docxMeta.data.webViewLink;

    // Export PDF — add small retry since Drive may not have processed the update yet
    let pdfBase64 = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000)); // wait 2s between retries
        const pdfRes = await drive.files.export(
          { fileId: docxId, mimeType: 'application/pdf' },
          { responseType: 'arraybuffer' }
        );
        const pdfBuf = Buffer.from(pdfRes.data);
        if (pdfBuf.length > 1000) { // sanity check — real PDFs are much larger
          pdfBase64 = pdfBuf.toString('base64');
          break;
        }
      } catch (e) {
        if (attempt === 2) console.error('PDF export failed after 3 attempts:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ docxId, docxUrl, pdfUrl: docxUrl, pdfBase64, fileName })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
