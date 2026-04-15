const { google } = require('googleapis');
const JSZip = require('jszip');

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
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
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

// Parse the Claude output — only headline and accomplishments
function parseTailoredSections(text) {
  const result = { headline: '', accomplishments: [] };

  const headlineMatch = text.match(/HEADLINE:\s*\n([\s\S]*?)(?=\nACCOMPLISHMENTS:|$)/i);
  if (headlineMatch) result.headline = headlineMatch[1].trim();

  const accMatch = text.match(/ACCOMPLISHMENTS:\s*\n([\s\S]*?)$/i);
  if (accMatch) {
    const accText = accMatch[1].trim();
    const items = accText.split(/\n(?=\d+\.)/);
    for (const item of items) {
      const m = item.match(/^\d+\.\s*([^:]+):\s*([\s\S]*)/);
      if (m) result.accomplishments.push({ title: m[1].trim(), body: m[2].trim().replace(/\n/g, ' ') });
    }
  }

  return result;
}

// Escape XML special characters
function escXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Extract run properties from a sample run in the document
function extractRunProps(xml, sectionName) {
  // Find the section and get run properties from first run
  const idx = xml.indexOf(sectionName);
  if (idx < 0) return '';
  const nearbyRun = xml.substring(Math.max(0, idx - 2000), idx + 500).match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  return nearbyRun ? nearbyRun[0] : '';
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
    if (!headline && accomplishments.length === 0) {
      throw new Error('Could not parse headline or accomplishments from resume text');
    }

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Download master Word doc
    const docRes = await drive.files.get(
      { fileId: MASTER_RESUME_ID, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const docBuffer = Buffer.from(docRes.data);

    // Unzip
    const zip = await JSZip.loadAsync(docBuffer);
    let xml = await zip.file('word/document.xml').async('string');

    // ── Replace Headline ─────────────────────────────────────────────
    // The headline is the paragraph(s) between the contact line and "RELEVANT ACCOMPLISHMENTS"
    // Strategy: find all paragraphs, identify the headline paragraph by its position and content length
    
    // Find the index of RELEVANT ACCOMPLISHMENTS section header paragraph
    const relAccPara = xml.match(/<w:p\b[^>]*>(?:(?!<w:p[ >]).)*?RELEVANT ACCOMPLISHMENTS(?:(?!<\/w:p>).)*?<\/w:p>/s);
    if (!relAccPara) throw new Error('Could not find RELEVANT ACCOMPLISHMENTS in document');
    
    const relAccIdx = xml.indexOf(relAccPara[0]);
    const beforeRelAcc = xml.substring(0, relAccIdx);
    
    // Find all paragraphs before RELEVANT ACCOMPLISHMENTS
    const allParas = [...beforeRelAcc.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
    
    // The headline paragraph is the last paragraph with substantial text (>50 chars of text content)
    let headlinePara = null;
    let headlineParaIdx = -1;
    let headlineParaEnd = -1;
    
    for (let i = allParas.length - 1; i >= 0; i--) {
      const textContent = allParas[i][0].replace(/<[^>]+>/g, '').trim();
      if (textContent.length > 50) {
        headlinePara = allParas[i][0];
        headlineParaIdx = allParas[i].index;
        headlineParaEnd = allParas[i].index + allParas[i][0].length;
        break;
      }
    }

    if (headlinePara && headline) {
      // Copy the paragraph structure but replace text content
      const pPr = headlinePara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
      const rPr = headlinePara.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
      
      const newPara = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escXml(headline)}</w:t></w:r></w:p>`;
      xml = xml.substring(0, headlineParaIdx) + newPara + xml.substring(headlineParaEnd);
    }

    // ── Replace Accomplishments ──────────────────────────────────────
    // Re-find positions after headline replacement
    const relAccPara2 = xml.match(/<w:p\b[^>]*>(?:(?!<w:p[ >]).)*?RELEVANT ACCOMPLISHMENTS(?:(?!<\/w:p>).)*?<\/w:p>/s);
    const empHistPara = xml.match(/<w:p\b[^>]*>(?:(?!<w:p[ >]).)*?EMPLOYMENT HISTORY(?:(?!<\/w:p>).)*?<\/w:p>/s);
    
    if (relAccPara2 && empHistPara && accomplishments.length > 0) {
      const accStartIdx = xml.indexOf(relAccPara2[0]) + relAccPara2[0].length;
      const accEndIdx = xml.indexOf(empHistPara[0]);
      
      if (accStartIdx > 0 && accEndIdx > accStartIdx) {
        // Get a sample accomplishment paragraph for formatting reference
        const sampleArea = xml.substring(accStartIdx, accEndIdx);
        const samplePara = sampleArea.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/);
        
        let newAccXml = '';
        for (const acc of accomplishments) {
          if (samplePara) {
            const pPr = samplePara[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
            const rPr = samplePara[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
            const rPrItalic = rPr ? rPr.replace('</w:rPr>', '<w:i/></w:rPr>') : '<w:rPr><w:i/></w:rPr>';
            
            newAccXml += `<w:p>${pPr}` +
              `<w:r>${rPrItalic}<w:t xml:space="preserve">${escXml(acc.title)}: </w:t></w:r>` +
              `<w:r>${rPr}<w:t xml:space="preserve">${escXml(acc.body)}</w:t></w:r>` +
              `</w:p>`;
          } else {
            newAccXml += `<w:p>` +
              `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escXml(acc.title)}: </w:t></w:r>` +
              `<w:r><w:t xml:space="preserve">${escXml(acc.body)}</w:t></w:r>` +
              `</w:p>`;
          }
        }
        
        xml = xml.substring(0, accStartIdx) + newAccXml + xml.substring(accEndIdx);
      }
    }

    // Repack
    zip.file('word/document.xml', xml);
    const newDocBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    // Upload to Drive
    const resumesFolderId = await findOrCreateFolder(drive, 'Resumes', APP_FOLDER_ID);
    const now = new Date();
    const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const fileName = `${company} — ${role} — ${monthYear}`;

    const { Readable } = require('stream');

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

    // Export as PDF
    const pdfRes = await drive.files.export(
      { fileId: docxId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );

    const pdfUploaded = await drive.files.create({
      requestBody: {
        name: fileName + '.pdf',
        parents: [resumesFolderId],
        mimeType: 'application/pdf'
      },
      media: { mimeType: 'application/pdf', body: Readable.from(Buffer.from(pdfRes.data)) },
      fields: 'id, webViewLink'
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        docxId, docxUrl,
        pdfId: pdfUploaded.data.id,
        pdfUrl: pdfUploaded.data.webViewLink,
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
