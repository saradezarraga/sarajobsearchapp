const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, 
        Table, TableRow, TableCell, WidthType, ShadingType, LevelFormat,
        UnderlineType } = require('docx');
const { google } = require('googleapis');

const APP_FOLDER_ID = '1koBBe1Th7qmD2AAF3eljwNor8gPYcl5f';

// Parse the tailored resume text into structured sections
function parseResume(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const result = {
    name: '',
    contact: '',
    headline: [],
    accomplishments: [],
    employment: [],
    education: [],
    community: [],
    personal: ''
  };

  let currentSection = null;
  let currentAccomplishment = null;
  let currentJob = null;
  let currentEdu = null;
  let headlineLines = [];
  let inHeadline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();

    // Name line
    if (i === 0 || (line.startsWith('#') && !line.startsWith('##'))) {
      result.name = clean;
      continue;
    }

    // Contact line (has @ or phone pattern)
    if (clean.includes('@') && clean.includes('|')) {
      result.contact = clean;
      continue;
    }

    // Section headers
    if (/headline summary/i.test(clean)) { inHeadline = true; currentSection = 'headline'; continue; }
    if (/relevant accomplishments/i.test(clean)) { inHeadline = false; currentSection = 'accomplishments'; continue; }
    if (/employment history/i.test(clean)) { currentSection = 'employment'; continue; }
    if (/^education$/i.test(clean)) { currentSection = 'education'; continue; }
    if (/community leadership/i.test(clean)) { currentSection = 'community'; continue; }
    if (/^personal$/i.test(clean)) { currentSection = 'personal'; continue; }

    if (currentSection === 'headline') {
      if (clean) result.headline.push(clean);
      continue;
    }

    if (currentSection === 'accomplishments') {
      // Numbered accomplishment: "1. *Title*: body..."
      const accMatch = clean.match(/^(\d+)\.\s*\*?(.+?)\*?:\s*(.*)/);
      if (accMatch) {
        if (currentAccomplishment) result.accomplishments.push(currentAccomplishment);
        currentAccomplishment = { title: accMatch[2].replace(/\*/g, ''), body: accMatch[3] };
      } else if (currentAccomplishment && clean) {
        currentAccomplishment.body += ' ' + clean;
      }
      continue;
    }

    if (currentSection === 'employment') {
      // Company line (ALL CAPS or bold company name)
      if (/^(RAPIDSOS|FLARE|INTERNATIONAL FINANCE|UBS)/i.test(clean) || (clean.includes(',') && /\d{4}/.test(clean) && clean === clean.toUpperCase())) {
        if (currentJob) result.employment.push(currentJob);
        const dateMatch = clean.match(/(\d{4}\s*[-–]\s*\d{4}|\d{4}\s*[-–]\s*present)/i);
        currentJob = { 
          company: dateMatch ? clean.replace(dateMatch[0], '').replace(/,\s*$/, '').trim() : clean,
          dates: dateMatch ? dateMatch[0] : '',
          location: '',
          title: '',
          description: ''
        };
      } else if (currentJob && !currentJob.title && !/^\d{4}/.test(clean)) {
        currentJob.title = clean;
      } else if (currentJob) {
        currentJob.description += (currentJob.description ? ' ' : '') + clean;
      }
      continue;
    }

    if (currentSection === 'education') {
      if (/^(HARVARD|WELLESLEY)/i.test(clean)) {
        if (currentEdu) result.education.push(currentEdu);
        const dateMatch = clean.match(/(\d{4}\s*[-–]\s*\d{4})/);
        currentEdu = {
          school: dateMatch ? clean.replace(dateMatch[0], '').trim() : clean,
          dates: dateMatch ? dateMatch[0] : '',
          degree: '',
          details: ''
        };
      } else if (currentEdu && !currentEdu.degree) {
        currentEdu.degree = clean;
      } else if (currentEdu) {
        currentEdu.details += (currentEdu.details ? ' ' : '') + clean;
      }
      continue;
    }

    if (currentSection === 'community') {
      if (clean.startsWith('-') || clean.startsWith('•')) {
        result.community.push(clean.replace(/^[-•]\s*/, ''));
      } else if (clean) {
        result.community.push(clean);
      }
      continue;
    }

    if (currentSection === 'personal') {
      result.personal += (result.personal ? ' ' : '') + clean;
      continue;
    }
  }

  // Push last items
  if (currentAccomplishment) result.accomplishments.push(currentAccomplishment);
  if (currentJob) result.employment.push(currentJob);
  if (currentEdu) result.education.push(currentEdu);

  return result;
}

function buildDoc(parsed) {
  const GOLD = 'B8963D';
  const INK = '1A1A2E';
  const GRAY = '5A5A7A';
  const LINE_COLOR = 'C9A84C';

  const border_bottom = {
    bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE_COLOR }
  };

  const sectionHeader = (text) => new Paragraph({
    border: border_bottom,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({
      text: text.toUpperCase(),
      font: 'Garamond',
      size: 20,
      bold: true,
      color: INK,
      characterSpacing: 40
    })]
  });

  const children = [];

  // NAME
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({
      text: parsed.name || 'Sara de Zárraga',
      font: 'Garamond',
      size: 36,
      bold: true,
      color: INK,
      allCaps: true
    })]
  }));

  // CONTACT
  if (parsed.contact) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({
        text: parsed.contact,
        font: 'Garamond',
        size: 18,
        color: GRAY
      })]
    }));
  }

  // HEADLINE
  if (parsed.headline.length > 0) {
    const headlineText = parsed.headline.join(' ');
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 160 },
      children: [new TextRun({
        text: headlineText,
        font: 'Garamond',
        size: 20,
        color: INK,
        italics: true
      })]
    }));
  }

  // RELEVANT ACCOMPLISHMENTS
  if (parsed.accomplishments.length > 0) {
    children.push(sectionHeader('Relevant Accomplishments'));
    parsed.accomplishments.forEach((acc, idx) => {
      children.push(new Paragraph({
        spacing: { before: 80, after: 60 },
        numbering: { reference: 'numbers', level: 0 },
        children: [
          new TextRun({ text: acc.title + ': ', font: 'Garamond', size: 20, italics: true, bold: false }),
          new TextRun({ text: acc.body, font: 'Garamond', size: 20 })
        ]
      }));
    });
  }

  // EMPLOYMENT HISTORY
  if (parsed.employment.length > 0) {
    children.push(sectionHeader('Employment History'));
    parsed.employment.forEach(job => {
      // Company + dates row
      children.push(new Paragraph({
        spacing: { before: 100, after: 20 },
        children: [
          new TextRun({ text: job.company, font: 'Garamond', size: 20, bold: true }),
          new TextRun({ text: job.dates ? '  ' + job.dates : '', font: 'Garamond', size: 20, color: GRAY })
        ]
      }));
      if (job.title) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: job.title, font: 'Garamond', size: 20, italics: true })]
        }));
      }
      if (job.description) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: job.description, font: 'Garamond', size: 18, color: INK })]
        }));
      }
    });
  }

  // EDUCATION
  if (parsed.education.length > 0) {
    children.push(sectionHeader('Education'));
    parsed.education.forEach(edu => {
      children.push(new Paragraph({
        spacing: { before: 100, after: 20 },
        children: [
          new TextRun({ text: edu.school, font: 'Garamond', size: 20, bold: true }),
          new TextRun({ text: edu.dates ? '  ' + edu.dates : '', font: 'Garamond', size: 20, color: GRAY })
        ]
      }));
      if (edu.degree) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: edu.degree, font: 'Garamond', size: 20, italics: true })]
        }));
      }
      if (edu.details) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: edu.details, font: 'Garamond', size: 18, color: INK })]
        }));
      }
    });
  }

  // COMMUNITY LEADERSHIP
  if (parsed.community.length > 0) {
    children.push(sectionHeader('Community Leadership'));
    parsed.community.forEach(item => {
      children.push(new Paragraph({
        spacing: { before: 40, after: 40 },
        numbering: { reference: 'bullets', level: 0 },
        children: [new TextRun({ text: item, font: 'Garamond', size: 18 })]
      }));
    });
  }

  // PERSONAL
  if (parsed.personal) {
    children.push(sectionHeader('Personal'));
    children.push(new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: parsed.personal, font: 'Garamond', size: 18 })]
    }));
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: '\u2022',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 180 } } }
          }]
        },
        {
          reference: 'numbers',
          levels: [{
            level: 0, format: LevelFormat.DECIMAL, text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 280 } } }
          }]
        }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 720, right: 1080, bottom: 720, left: 1080 }
        }
      },
      children
    }]
  });

  return doc;
}

async function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT not set');
  
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    // Try fixing escaped newlines
    try {
      creds = JSON.parse(raw.replace(/\\n/g, '\n'));
    } catch (e2) {
      throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT: ' + e2.message);
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return auth;
}

async function findOrCreateFolder(drive, name, parentId) {
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)'
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  
  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id'
  });
  return folder.data.id;
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

    // Build docx
    const parsed = parseResume(resumeText);
    const doc = buildDoc(parsed);
    const buffer = await Packer.toBuffer(doc);

    // Save to Google Drive
    const auth = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Find or create Resumes folder
    const resumesFolderId = await findOrCreateFolder(drive, 'Resumes', APP_FOLDER_ID);

    // File name: Company — Role — Month Year
    const now = new Date();
    const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const fileName = `${company} — ${role} — ${monthYear}`;

    // Upload docx
    const { Readable } = require('stream');
    const docxStream = new Readable();
    docxStream.push(buffer);
    docxStream.push(null);

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName + '.docx',
        parents: [resumesFolderId],
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      media: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: docxStream },
      fields: 'id, webViewLink'
    });

    const docxId = uploaded.data.id;
    const docxUrl = uploaded.data.webViewLink;

    // Export as PDF
    const pdfRes = await drive.files.export({
      fileId: docxId,
      mimeType: 'application/pdf'
    }, { responseType: 'arraybuffer' });

    const pdfBuffer = Buffer.from(pdfRes.data);
    const pdfStream = new Readable();
    pdfStream.push(pdfBuffer);
    pdfStream.push(null);

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
      body: JSON.stringify({ error: err.message })
    };
  }
};
