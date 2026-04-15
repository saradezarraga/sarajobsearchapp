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

// Convert tailored text to Word XML paragraph runs
function textToXmlRuns(text, bold = false, italic = false, fontSize = null) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  
  let rPr = '';
  if (bold) rPr += '<w:b/>';
  if (italic) rPr += '<w:i/>';
  if (fontSize) rPr += `<w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/>`;
  
  return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escaped}</w:t></w:r>`;
}

// Build XML for the headline paragraph
function buildHeadlineParagraph(headlineText, originalParagraphXml) {
  // Extract paragraph properties from original
  const pPrMatch = originalParagraphXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '<w:pPr><w:jc w:val="center"/></w:pPr>';
  
  return `<w:p>${pPr}${textToXmlRuns(headlineText)}</w:p>`;
}

// Parse the tailored resume text into headline and accomplishments
function parseTailored(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let headline = [];
  let accomplishments = [];
  let section = null;
  let currentAcc = null;

  for (const line of lines) {
    const clean = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    if (/headline summary/i.test(clean)) { section = 'headline'; continue; }
    if (/relevant accomplishments/i.test(clean)) { section = 'accomplishments'; continue; }
    if (/employment history/i.test(clean) || /^education$/i.test(clean)) { section = null; break; }

    if (section === 'headline' && clean) {
      headline.push(clean);
    }

    if (section === 'accomplishments') {
      const match = clean.match(/^(\d+)\.\s*\*?([^*:]+)\*?:\s*(.*)/);
      if (match) {
        if (currentAcc) accomplishments.push(currentAcc);
        currentAcc = { title: match[2].trim(), body: match[3].trim() };
      } else if (currentAcc && clean) {
        currentAcc.body += ' ' + clean;
      }
    }
  }
  if (currentAcc) accomplishments.push(currentAcc);

  return { headline: headline.join(' '), accomplishments };
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

    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Download master Word doc as binary
    const docRes = await drive.files.get(
      { fileId: MASTER_RESUME_ID, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const docBuffer = Buffer.from(docRes.data);

    // Unzip the docx
    const zip = await JSZip.loadAsync(docBuffer);
    let documentXml = await zip.file('word/document.xml').async('string');

    // Parse what we need to replace
    const { headline, accomplishments } = parseTailored(resumeText);

    // ── Replace Headline ──────────────────────────────────────────────
    // Find the headline paragraph(s) — they come after the contact line and before Relevant Accomplishments
    // Strategy: find all <w:p>...</w:p> blocks between contact info and "Relevant Accomplishments"
    
    // Find where "Relevant Accomplishments" section heading starts
    const relAccMatch = documentXml.match(/<w:p>(?:(?!<w:p>).)*?Relevant Accomplishments(?:(?!<\/w:p>).)*?<\/w:p>/s);
    
    if (relAccMatch) {
      const relAccIndex = documentXml.indexOf(relAccMatch[0]);
      
      // Find the headline paragraph - it's between the header/contact area and Relevant Accomplishments
      // Look backwards from Relevant Accomplishments to find paragraph(s) with substantial text
      const beforeRelAcc = documentXml.substring(0, relAccIndex);
      
      // Find the last few paragraphs before Relevant Accomplishments - these are the headline
      const paragraphMatches = [...beforeRelAcc.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)];
      
      // The headline is typically 1-3 paragraphs before the section header
      // Find paragraphs that contain the headline text (long sentences, not just names/contact)
      let headlineStart = -1;
      let headlineEnd = -1;
      
      for (let i = paragraphMatches.length - 1; i >= 0; i--) {
        const para = paragraphMatches[i];
        const textContent = para[0].replace(/<[^>]+>/g, '').trim();
        // Skip empty paragraphs and very short ones (name, contact)
        if (textContent.length > 50) {
          headlineEnd = para.index + para[0].length;
          headlineStart = para.index;
          break;
        }
      }

      if (headlineStart >= 0 && headline) {
        const originalPara = documentXml.substring(headlineStart, headlineEnd);
        // Build new headline paragraph preserving original formatting
        const pPrMatch = originalPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
        const pPr = pPrMatch ? pPrMatch[0] : '';
        // Extract rPr (run properties) from original
        const rPrMatch = originalPara.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
        const rPr = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : '';
        
        const escapedHeadline = headline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const newPara = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapedHeadline}</w:t></w:r></w:p>`;
        
        documentXml = documentXml.substring(0, headlineStart) + newPara + documentXml.substring(headlineEnd);
      }
    }

    // ── Replace Accomplishments ──────────────────────────────────────
    // Find all accomplishment paragraphs (numbered 1-5) and replace them
    if (accomplishments.length > 0) {
      // Re-find Relevant Accomplishments section (position may have shifted)
      const relAccMatch2 = documentXml.match(/<w:p>(?:(?!<w:p>).)*?Relevant Accomplishments(?:(?!<\/w:p>).)*?<\/w:p>/s);
      const empHistMatch = documentXml.match(/<w:p>(?:(?!<w:p>).)*?Employment History(?:(?!<\/w:p>).)*?<\/w:p>/s);
      
      if (relAccMatch2 && empHistMatch) {
        const accStart = documentXml.indexOf(relAccMatch2[0]) + relAccMatch2[0].length;
        const accEnd = documentXml.indexOf(empHistMatch[0]);
        
        if (accStart > 0 && accEnd > accStart) {
          // Get a sample accomplishment paragraph to copy formatting
          const sampleAccPara = documentXml.substring(accStart, accEnd).match(/<w:p>[\s\S]*?<\/w:p>/);
          
          let newAccXml = '';
          accomplishments.forEach((acc, i) => {
            const escapedTitle = acc.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const escapedBody = acc.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            if (sampleAccPara) {
              // Copy paragraph properties from original
              const pPrMatch = sampleAccPara[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
              const pPr = pPrMatch ? pPrMatch[0] : '';
              
              newAccXml += `<w:p>${pPr}` +
                `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${i + 1}. ${escapedTitle}: </w:t></w:r>` +
                `<w:r><w:t xml:space="preserve">${escapedBody}</w:t></w:r>` +
                `</w:p>`;
            } else {
              newAccXml += `<w:p>` +
                `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${i + 1}. ${escapedTitle}: </w:t></w:r>` +
                `<w:r><w:t xml:space="preserve">${escapedBody}</w:t></w:r>` +
                `</w:p>`;
            }
          });
          
          documentXml = documentXml.substring(0, accStart) + newAccXml + documentXml.substring(accEnd);
        }
      }
    }

    // Update the zip with modified document.xml
    zip.file('word/document.xml', documentXml);
    const newDocBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    // Upload to Drive
    const resumesFolderId = await findOrCreateFolder(drive, 'Resumes', APP_FOLDER_ID);
    const now = new Date();
    const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const fileName = `${company} — ${role} — ${monthYear}`;

    const { Readable } = require('stream');
    const docxStream = Readable.from(newDocBuffer);

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName + '.docx',
        parents: [resumesFolderId],
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: docxStream
      },
      fields: 'id, webViewLink'
    });

    const docxId = uploaded.data.id;
    const docxUrl = uploaded.data.webViewLink;

    // Export as PDF via Google Drive conversion
    const pdfRes = await drive.files.export(
      { fileId: docxId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );

    const pdfBuffer = Buffer.from(pdfRes.data);
    const pdfStream = Readable.from(pdfBuffer);

    const pdfUploaded = await drive.files.create({
      requestBody: {
        name: fileName + '.pdf',
        parents: [resumesFolderId],
        mimeType: 'application/pdf'
      },
      media: { mimeType: 'application/pdf', body: pdfStream },
      fields: 'id, webViewLink'
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        docxId,
        docxUrl,
        pdfId: pdfUploaded.data.id,
        pdfUrl: pdfUploaded.data.webViewLink,
        fileName
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, stack: err.stack })
    };
  }
};
