import { useState, useEffect, useCallback, useRef } from "react";

const DRIVE_FILE_IDS = {
  masterResume: "1Wt72BdV8NPrbE_lYHVGQGQwq3fzN6Ixh",
  sourceMaterial: "1sIGAAn4oqbD7vqQCo6AWpy5V--cogSgA03gXNJSFw20",
  tailoringRules: "1jJ9s2ket9MmTYcpWbU8jhjlqBcieDmC1JpqYZo6rA7o",
};
const STORAGE_KEY = "jsa_v1";

function renderMarkdown(text) {
  if (!text) return "";
  // Handle clean HEADLINE/ACCOMPLISHMENTS format from Claude
  if (text.includes('HEADLINE:') || text.includes('ACCOMPLISHMENTS:') || text.includes('Headline Summary') || text.includes('Relevant Accomplishments')) {
    return text
      .replace(/^(?:HEADLINE:|##\s*Headline Summary|Headline Summary:?)\s*/gim, '<h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5a5a7a;margin:14px 0 6px">Headline Summary</h3>')
      .replace(/^(?:ACCOMPLISHMENTS:|##\s*Relevant Accomplishments|Relevant Accomplishments:?)\s*/gim, '<h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5a5a7a;margin:14px 0 6px">Relevant Accomplishments</h3>')
      .replace(/^(\d+)\. \*([^*]+)\*: (.+)$/gm, '<div style="margin-bottom:10px"><strong>$1. <em>$2</em>:</strong> $3</div>')
      .replace(/^(\d+)\. ([^:]+): (.+)$/gm, '<div style="margin-bottom:10px"><strong>$1. <em>$2</em>:</strong> $3</div>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
  }
  return text
    .replace(/^# (.+)$/gm, "<h1 style='font-family:Georgia,serif;font-size:18px;font-weight:700;margin:0 0 4px'>$1</h1>")
    .replace(/^## (.+)$/gm, "<h2 style='font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 6px;color:#5a5a7a'>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^(\d+)\. \*(.+?)\*: (.+)$/gm, "<div style='margin-bottom:10px'><strong>$1. <em>$2</em>:</strong> $3</div>")
    .replace(/^(\d+)\. (.+)$/gm, "<div style='margin-bottom:10px'><strong>$1.</strong> $2</div>")
    .replace(/^[-] (.+)$/gm, "<div style='padding-left:16px;margin-bottom:3px'>&bull; $1</div>")
    .replace(/---+/g, "<hr style='border:none;border-top:1px solid #e2ddd5;margin:10px 0'/>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
const DEFAULT_HUNTER_KEY = "ENTER_YOUR_HUNTER_KEY_HERE";

async function callClaude(sys, msg, maxTokens = 4000, injectDocs = false) {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system: sys, messages: [{ role: "user", content: msg }] };
  if (injectDocs) body.injectDocs = true;
  const res = await fetch("/.netlify/functions/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error.error || JSON.stringify(data.error));
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

async function hunterLookup(fn, ln, domain, key) {
  try {
    const r = await fetch(`https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}&api_key=${key}`);
    const d = await r.json();
    return d.data?.email || null;
  } catch { return null; }
}

function altFormats(fn, ln, domain) {
  const f = fn.toLowerCase(), l = ln.toLowerCase();
  return [`${f}.${l}@${domain}`, `${f}${l}@${domain}`, `${f[0]}${l}@${domain}`, `${f}@${domain}`];
}

function parseCSV(text) {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const h = lines[0].toLowerCase().replace(/"/g, "").split(",").map(c => c.trim());
  const idx = (terms) => h.findIndex(c => terms.some(t => c.includes(t)));
  const fi = idx(["first"]), li = idx(["last"]), ci = idx(["company"]), ti = idx(["position", "title"]), ei = idx(["email"]);
  return lines.slice(1).map(line => {
    const p = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.replace(/"/g, "").trim());
    const g = i => i >= 0 ? p[i] || "" : "";
    return { firstName: g(fi), lastName: g(li), company: g(ci), title: g(ti), email: g(ei), fullName: `${g(fi)} ${g(li)}`.trim() };
  }).filter(c => c.fullName.trim().length > 1);
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#1a1a2e;--ink-l:#5a5a7a;--cream:#faf8f5;--warm:#f5f0e8;--gold:#c9a84c;--gold-l:#e8d5a0;--gold-p:#fdf9ee;--border:#e2ddd5;--white:#fff;--sh:0 2px 12px rgba(26,26,46,.07);--sh-lg:0 8px 40px rgba(26,26,46,.12);--r:10px;--rs:6px}
body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--ink)}
.app{min-height:100vh;display:flex;flex-direction:column}
.hdr{background:var(--ink);padding:0 36px;height:60px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--gold);position:sticky;top:0;z-index:200}
.hdr-brand{display:flex;align-items:center;gap:12px}
.mono{width:34px;height:34px;background:var(--gold);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:14px;font-weight:700;color:var(--ink)}
.brand-t{font-family:'Playfair Display',serif;font-size:17px;color:var(--cream);font-weight:600}
.brand-s{font-size:10px;color:var(--gold-l);letter-spacing:.12em;text-transform:uppercase}
.nav{display:flex;gap:6px}
.nb{padding:7px 16px;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;border:1px solid transparent}
.nb-ghost{background:transparent;color:var(--gold-l);border-color:rgba(201,168,76,.3)}
.nb-ghost:hover{background:rgba(201,168,76,.12);border-color:var(--gold);color:var(--gold)}
.nb-pri{background:var(--gold);color:var(--ink);font-weight:600}
.nb-pri:hover{background:#b8963d}
.nb-act{background:rgba(201,168,76,.18);color:var(--gold);border-color:var(--gold)}
.main{max-width:1180px;margin:0 auto;padding:36px;width:100%}
.pg-t{font-family:'Playfair Display',serif;font-size:26px;font-weight:700}
.pg-s{font-size:14px;color:var(--ink-l);margin-top:4px}
.flex-bw{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.mb28{margin-bottom:28px}.mb20{margin-bottom:20px}.mb12{margin-bottom:12px}.mt16{margin-top:16px}.mt8{margin-top:8px}
.divider{height:1px;background:var(--border);margin:20px 0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}
.stat{background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:18px 22px;box-shadow:var(--sh)}
.stat-l{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-l);font-weight:600;margin-bottom:6px}
.stat-v{font-family:'Playfair Display',serif;font-size:30px;font-weight:700;line-height:1}
.alert{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:var(--rs);margin-bottom:8px;font-size:13px;font-weight:500}
.al-warn{background:#fff8ec;border:1px solid #f0c060;color:#7a5500}
.al-ok{background:#f0f9f2;border:1px solid #90d0a0;color:#1a4a2a}
.al-acts{display:flex;gap:8px;margin-top:8px}
.al-btn{padding:4px 11px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid currentColor;background:transparent;font-family:'DM Sans',sans-serif}
.tbl{background:var(--white);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--sh);overflow:hidden}
.tbl-h{display:grid;grid-template-columns:2fr 1.4fr .9fr 1.2fr 1fr 90px;padding:10px 22px;background:var(--warm);border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-l);font-weight:600}
.jr{border-bottom:1px solid var(--border)}.jr:last-child{border-bottom:none}
.jr-main{display:grid;grid-template-columns:2fr 1.4fr .9fr 1.2fr 1fr 90px;padding:14px 22px;align-items:center;cursor:pointer;transition:background .15s}
.jr-main:hover{background:var(--gold-p)}
.j-co{font-weight:600;font-size:14px}.j-ro{font-size:11px;color:var(--ink-l);margin-top:2px}
.j-dt{font-size:13px;color:var(--ink-l)}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.b-active{background:#e8f2ff;color:#1a5aaa}.b-paused{background:#fff8e0;color:#aa6600}.b-complete{background:#f0f9f0;color:#2a7a3a}.b-attention{background:#fff0ee;color:#aa3322}.b-draft{background:#f5f5f5;color:#666}
.j-cc{font-size:12px;color:var(--ink-l)}
.exp-btn{background:none;border:1px solid var(--border);border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--ink-l);transition:all .15s;font-family:'DM Sans',sans-serif}
.exp-btn:hover{background:var(--warm);color:var(--ink);border-color:var(--gold)}
.jd-detail{padding:16px 22px 20px;background:var(--gold-p);border-top:1px solid var(--border)}
.d-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.dl{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-l);font-weight:600;margin-bottom:8px}
.cdr{display:flex;align-items:center;gap:8px;padding:7px 11px;background:var(--white);border:1px solid var(--border);border-radius:var(--rs);margin-bottom:5px;font-size:12px}
.cn{width:18px;height:18px;background:var(--gold);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--ink);flex-shrink:0}
.ci{flex:1}.c-n{font-weight:600;font-size:12px}.c-s{font-size:10px;color:var(--ink-l)}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.d-p{background:#ccc}.d-s{background:#4a90d9}.d-r{background:#4ac970}.d-b{background:#d94a4a}.d-nr{background:#d9a44a}
.sk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.sk{padding:8px 12px;background:var(--warm);border:1px solid var(--border);border-radius:var(--rs)}
.sk-t{font-weight:700;font-size:12px;margin-bottom:3px}.sk-d{font-size:11px;color:var(--ink-l);line-height:1.4}
.wf{background:var(--white);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--sh-lg);overflow:hidden}
.wf-h{padding:18px 26px;background:var(--ink);display:flex;align-items:center;justify-content:space-between}
.wf-t{font-family:'Playfair Display',serif;font-size:18px;color:var(--cream);font-weight:600}
.wf-sl{font-size:11px;color:var(--gold-l);letter-spacing:.08em;text-transform:uppercase}
.wf-b{padding:26px}
.steps{display:flex;align-items:flex-start;margin-bottom:28px}
.s-item{display:flex;align-items:center;flex:1}
.s-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;border:2px solid var(--border);background:var(--white);color:var(--ink-l);transition:all .3s}
.s-dot.active{background:var(--gold);border-color:var(--gold);color:var(--ink)}
.s-dot.done{background:var(--ink);border-color:var(--ink);color:var(--gold)}
.s-line{flex:1;height:2px;background:var(--border)}.s-line.done{background:var(--ink)}
.s-lbl{font-size:10px;color:var(--ink-l);text-align:center;margin-top:4px}
.fg{margin-bottom:18px}
.fl{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-l);margin-bottom:6px}
.fi{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--rs);font-family:'DM Sans',sans-serif;font-size:14px;color:var(--ink);background:var(--white);transition:border-color .18s;outline:none}
.fi:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.12)}
.fta{min-height:120px;resize:vertical;line-height:1.5}
.fh{font-size:11px;color:var(--ink-l);margin-top:5px}
.f-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.btn{padding:10px 22px;border-radius:var(--rs);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;transition:all .18s;border:1px solid transparent;display:inline-flex;align-items:center;gap:7px}
.btn-pri{background:var(--gold);color:var(--ink);border-color:var(--gold)}.btn-pri:hover{background:#b8963d}.btn-pri:disabled{opacity:.45;cursor:not-allowed}
.btn-sec{background:var(--white);color:var(--ink);border-color:var(--border)}.btn-sec:hover{background:var(--warm)}
.btn-gh{background:transparent;color:var(--ink-l);border-color:var(--border)}.btn-gh:hover{color:var(--ink)}
.btn-row{display:flex;gap:10px;align-items:center;margin-top:20px;flex-wrap:wrap}
.ccr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--warm);border:1px solid var(--border);border-radius:var(--rs);margin-bottom:8px;cursor:pointer;transition:all .15s}
.ccr:hover,.ccr.sel{border-color:var(--gold);background:var(--gold-p)}
.si{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--white);border:1px solid var(--border);border-radius:var(--rs);margin-bottom:8px;cursor:grab;user-select:none}
.si:active{cursor:grabbing;box-shadow:var(--sh-lg)}
.sn{width:22px;height:22px;background:var(--gold);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--ink);flex-shrink:0}
.si-info{flex:1}.si-name{font-weight:600;font-size:13px}.si-sub{font-size:11px;color:var(--ink-l)}
.tb{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600}
.tb-fd{background:#e8f2ff;color:#1a5aaa}.tb-al{background:#f0f9f0;color:#2a7a3a}.tb-bt{background:#fff8e0;color:#aa6600}
.r-prev{background:var(--warm);border:1px solid var(--border);border-radius:var(--rs);padding:20px;max-height:480px;overflow-y:auto;font-size:13px;line-height:1.65;white-space:pre-wrap}
.r-edit{width:100%;padding:10px 14px;border:1px solid var(--gold);border-radius:var(--rs);font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);background:var(--white);outline:none;resize:vertical;min-height:400px;line-height:1.6}
.em-card{background:var(--warm);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:16px}
.em-h{padding:10px 16px;background:var(--white);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.em-to{font-size:12px;color:var(--ink-l)}
.em-b{padding:14px 16px;font-size:13px;line-height:1.65;white-space:pre-wrap;max-height:200px;overflow-y:auto}
.em-ft{padding:6px 14px 10px;background:var(--gold-p);font-size:10px;color:var(--ink-l);text-transform:uppercase;letter-spacing:.08em}
.acf{background:var(--warm);border:1px solid var(--border);border-radius:var(--rs);padding:16px;margin-top:12px}
.upz{border:2px dashed var(--border);border-radius:var(--r);padding:24px;text-align:center;cursor:pointer;transition:all .18s;background:var(--warm)}
.upz:hover{border-color:var(--gold);background:var(--gold-p)}.upz.has{border-color:#7b9e87;background:#f0f9f2;border-style:solid}
.lov{position:fixed;inset:0;background:rgba(26,26,46,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(3px)}
.lc{background:var(--white);border-radius:var(--r);padding:32px 40px;text-align:center;box-shadow:var(--sh-lg);min-width:280px}
.ls{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
.lm{font-size:15px;font-weight:500}.ls2{font-size:12px;color:var(--ink-l);margin-top:6px}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.ss{background:var(--warm);border:1px solid var(--border);border-radius:var(--r);padding:20px}
.ss-t{font-family:'Playfair Display',serif;font-size:15px;font-weight:600;margin-bottom:14px}
.empty{text-align:center;padding:60px 20px}
.empty-i{font-size:40px;margin-bottom:16px}
.empty-t{font-family:'Playfair Display',serif;font-size:20px;font-weight:600;margin-bottom:8px}
.empty-d{font-size:14px;color:var(--ink-l);max-width:380px;margin:0 auto 20px;line-height:1.6}
.txt-sm{font-size:12px;color:var(--ink-l)}.txt-b{font-weight:600}
`;

export default function App() {
  const [view, setView] = useState("dashboard");
  const [jobs, setJobs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [hunterKey, setHunterKey] = useState(DEFAULT_HUNTER_KEY);
  const [liContacts, setLiContacts] = useState([]);
  const [driveContent, setDriveContent] = useState(null);
  const [step, setStep] = useState(0);
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [skills, setSkills] = useState([]);
  const [fdMatches, setFdMatches] = useState([]);
  const [selFd, setSelFd] = useState({});
  const [manContacts, setManContacts] = useState([]);
  const [newC, setNewC] = useState({ name: "", title: "", dept: "", linkedinUrl: "", type: "alumni" });
  const [ordered, setOrdered] = useState([]);
  const [tailored, setTailored] = useState("");
  const [editResume, setEditResume] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [dragI, setDragI] = useState(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (s.jobs) setJobs(s.jobs);
      if (s.hunterKey) setHunterKey(s.hunterKey);
      if (s.liContacts) setLiContacts(s.liContacts);
    } catch {}
  }, []);

  const save = (j = jobs, k = hunterKey, l = liContacts) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs: j, hunterKey: k, liContacts: l })); } catch {}
  };

  const setAndSaveJobs = (j) => { setJobs(j); save(j); };

  const loadDrive = async () => {
    // Docs baked into Netlify function
    return { masterResume: "{{MASTER_RESUME}}", sourceMaterial: "{{SOURCE_MATERIAL}}", tailoringRules: "{{TAILORING_RULES}}" };
  };

  useEffect(() => {
    const a = [];
    jobs.forEach(j => {
      if (j.noResponse) a.push({ id: `nr-${j.id}`, type: "warn", jobId: j.id, msg: `${j.company} (${j.role}): No responses after full sequence. Find additional contacts or follow up differently.` });
      (j.contacts || []).filter(c => c.status === "bounced" && c.altFailed).forEach(c =>
        a.push({ id: `b-${j.id}-${c.name}`, type: "warn", jobId: j.id, msg: `${j.company}: Email bounced for ${c.name} — no working address format found.` })
      );
      if (j.status === "paused") {
        const rep = (j.contacts || []).find(c => c.status === "replied");
        if (rep) a.push({ id: `rep-${j.id}`, type: "ok", jobId: j.id, canResume: true, msg: `${j.company} (${j.role}): ${rep.name} replied — sequence paused. Resume or close?` });
      }
    });
    setAlerts(a);
  }, [jobs]);

  const stats = {
    total: jobs.length,
    active: jobs.filter(j => j.status === "active").length,
    responses: jobs.filter(j => (j.contacts || []).some(c => c.status === "replied")).length,
    attention: jobs.filter(j => j.status === "paused" || j.noResponse || (j.contacts || []).some(c => c.status === "bounced" && c.altFailed)).length,
  };

  const step1 = async () => {
    if ((!jdText.trim() && !jdUrl.trim()) || !company.trim() || !role.trim()) return;
    setLoading(true); setLoadMsg("Analyzing job description…");
    try {
      const raw = await callClaude(
        `Extract 3-5 core skills/experiences from a job description. Return ONLY a JSON array: [{"title":"...","desc":"..."}]. No preamble.`,
        `JD:\n${jdText || "[URL: " + jdUrl + "]"}\nCompany: ${company}\nRole: ${role}`, 1200
      );
      let sk = [];
      try { sk = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch {}
      setSkills(sk);
      setFdMatches(liContacts.filter(c => c.company?.toLowerCase().includes(company.toLowerCase())));
      setSelFd({}); setManContacts([]);
      setLoading(false); setStep(1);
    } catch (e) { setLoading(false); alert(e.message); }
  };

  const step2 = () => {
    const fd = fdMatches.filter((_, i) => selFd[i]).map(c => ({ name: c.fullName, title: c.title, dept: c.company, email: c.email || null, type: "first_degree", status: "pending" }));
    setOrdered([...fd, ...manContacts.map(c => ({ ...c, status: "pending" }))]);
    setStep(2);
  };

  const step3 = async () => {
    setLoading(true); setLoadMsg("Loading documents and tailoring your resume…");
    try {
      const docs = await loadDrive();
      const res = await callClaude(
        `You are Sara de Zárraga's resume tailoring assistant. You update ONLY two sections of her resume for each job application.

TAILORING RULES:
{{TAILORING_RULES}}

SOURCE MATERIAL (accomplishments bank):
{{SOURCE_MATERIAL}}

CRITICAL INSTRUCTIONS:
- Return ONLY the two sections below. Nothing else. No name, no contact info, no employment history, no education, no other sections.
- Write in Sara's voice: confident, direct, first-person. No buzzwords. No markdown symbols.
- Format exactly as shown.`,
        `Update Sara's resume for this role.

JOB DESCRIPTION:
${jdText || "Role: " + role + " at " + company}

COMPANY: ${company}
ROLE: ${role}

Return ONLY this exact format — nothing before, nothing after:

HEADLINE:
[3-4 sentence headline paragraph. No bullet points. Plain text only.]

ACCOMPLISHMENTS:
1. [Title]: [Body text]
2. [Title]: [Body text]
3. [Title]: [Body text]
4. [Title]: [Body text]
5. [Title]: [Body text]

Select 3-5 accomplishments based on role fit. Each title should mirror the job description language. Each body is 4-7 sentences maximum. First person throughout. IMPORTANT: Total word count for headline + all accomplishments must not exceed 550 words. Be concise — no padding, no redundancy. If 5 accomplishments push over the limit, use 4.`,
        4000,
        true
      );
      setTailored(res); setEditResume(false); setLoading(false); setStep(3);
    } catch (e) { setLoading(false); alert(e.message); }
  };

  const [driveLinks, setDriveLinks] = useState({ docxUrl: null, pdfUrl: null, fileName: null });
  const [savedTemplates, setSavedTemplates] = useState(null);
  const [gmailConnected, setGmailConnected] = useState(null); // null=loading, true, false

  useEffect(() => {
    // Check Gmail auth status — check both env var (via function) and localStorage token
    const localToken = localStorage.getItem("gmail_refresh_token");
    if (localToken) {
      setGmailConnected(true);
    } else {
      fetch("/.netlify/functions/gmail-auth-status")
        .then(r => r.json())
        .then(d => setGmailConnected(d.connected))
        .catch(() => setGmailConnected(false));
    }
    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("gmail_auth");
    if (authResult === "success") {
      const rt = params.get("refresh_token");
      if (rt) localStorage.setItem("gmail_refresh_token", rt);
      setGmailConnected(true);
      window.history.replaceState({}, "", "/");
      alert("✓ Gmail connected! The app can now send emails on your behalf.");
    } else if (authResult === "error") {
      window.history.replaceState({}, "", "/");
      alert("Gmail connection failed: " + (params.get("reason") || "Unknown error"));
    }
  }, []);

  const saveResumeToDrive = async () => {
    setLoading(true); setLoadMsg("Copying master resume and editing sections…");
    try {
      const saveRes = await fetch("/.netlify/functions/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: tailored, company, role })
      });
      const saveData = await saveRes.json();
      if (saveData.error) throw new Error(saveData.error);
      setDriveLinks({ docxUrl: saveData.docxUrl, pdfUrl: saveData.pdfUrl, fileName: saveData.fileName, docxId: saveData.docxId || null });
      setLoading(false);
      setStep(4);
    } catch (e) {
      setLoading(false);
      alert("Drive save failed: " + e.message);
    }
  };

  const step5 = async () => {
    setLoading(true); setLoadMsg("Drafting referral emails…");
    // Load saved email templates from Drive if available
    let templateContext = "";
    try {
      const tplRes = await fetch("/.netlify/functions/load-email-templates");
      const tplData = await tplRes.json();
      if (tplData.content) {
        templateContext = `\n\nSAVED EMAIL TEMPLATES (use these as your base language, adapt for this specific contact/company):\n${tplData.content}`;
        setSavedTemplates(tplData.content);
      }
    } catch (e) { /* no templates saved yet, generate fresh */ }
    try {
      const results = await Promise.all(ordered.map(async c => {
        const rel = c.type === "first_degree" ? "first-degree LinkedIn connection" : c.type === "both" ? "LinkedIn connection AND HBS/Wellesley alum" : "HBS or Wellesley alum — no prior connection";
        const d = await callClaude(
          `Write warm, concise referral emails for Sara de Zárraga. Sara: Harvard MBA (HBS), Wellesley undergrad, UBS banking → World Bank IFC → founded/exited Flare (VC wearable tech). Write in her voice: confident, genuine, not corporate.`,
          `Email to ${c.name}${c.title ? " (" + c.title + ")" : ""} at ${company}. Role: ${role}. Relationship: ${rel}. Under 150 words. Ask for referral. Mention shared HBS/Wellesley if alumni. Be human.`,
          600
        );
        const subjectLine = `Introduction — ${role} at ${company}`;
        return { contact: c, draft: d, edited: d, editing: false, subject: subjectLine };
      }));
      setDrafts(results); setLoading(false); setStep(5);
    } catch (e) { setLoading(false); alert(e.message); }
  };

  const EMAIL_TEMPLATES_DOC_ID = "1bgH8z661NFFobZZjygQZ7kjgrXDqaI65LnDq7laCUpQ";

  const saveAsTemplate = async () => {
    try {
      const res = await fetch("/.netlify/functions/save-email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drafts: drafts.map(d => ({ label: d.contact?.type || "draft", subject: d.subject || "", edited: d.edited || d.draft || "" })) })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert("Templates saved! Future emails will use these as a base.");
    } catch (e) {
      alert("Failed to save templates: " + e.message);
    }
  };



  const launch = async () => {
    setLoading(true); setLoadMsg("Looking up email addresses…");
    try {
      const domain = company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
      const withEmails = await Promise.all(ordered.map(async c => {
        if (c.email) return { ...c, altFailed: false };
        const parts = c.name.split(" ");
        const email = await hunterLookup(parts[0] || "", parts[parts.length - 1] || "", domain, hunterKey);
        return { ...c, email: email || altFormats(parts[0] || "", parts[parts.length - 1] || "", domain)[0], altFailed: !email };
      }));

      // Send first email immediately with PDF attached
      setLoadMsg("Sending first email…");
      const firstContact = withEmails[0];
      const firstDraft = drafts.find(d => d.contact.name === firstContact.name) || drafts[0];
      if (firstContact && firstDraft && firstContact.email) {
        const sendRes = await fetch("/.netlify/functions/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: firstContact.email,
            subject: firstDraft.subject || `Introduction — ${role} at ${company}`,
            body: firstDraft.edited,
            docxId: driveLinks.docxId || null,
            pdfFileName: driveLinks.fileName ? driveLinks.fileName + ".pdf" : `${company} — ${role}.pdf`,
            refreshToken: localStorage.getItem("gmail_refresh_token") || null
          })
        });
        const sendData = await sendRes.json();
        if (sendData.error) throw new Error("Gmail send failed: " + sendData.error);
      }

      setLoadMsg("Saving application…");
      const newJob = {
        id: Date.now().toString(), company, role,
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        status: "active",
        contacts: withEmails.map((c, i) => ({ ...c, sequencePos: i + 1, status: i === 0 ? "sent" : "pending", sentAt: i === 0 ? new Date().toISOString() : null })),
        coreSkills: skills, tailoredResume: tailored, emailDrafts: drafts.map(d => d.edited),
        driveDocxUrl: driveLinks.docxUrl, drivePdfUrl: driveLinks.pdfUrl,
        createdAt: new Date().toISOString(),
      };
      const newJobs = [newJob, ...jobs];
      setAndSaveJobs(newJobs);
      setStep(0); setJdText(""); setJdUrl(""); setCompany(""); setRole(""); setSkills([]); setFdMatches([]); setSelFd({}); setManContacts([]); setOrdered([]); setTailored(""); setDrafts([]);
      setLoading(false); setView("dashboard");
    } catch (e) { setLoading(false); alert(e.message); }
  };

  const onDragStart = i => setDragI(i);
  const onDragOver = (e, i) => { e.preventDefault(); if (dragI === null || dragI === i) return; const a = [...ordered]; const [m] = a.splice(dragI, 1); a.splice(i, 0, m); setOrdered(a); setDragI(i); };
  const onDragEnd = () => setDragI(null);
  const addManual = () => { if (!newC.name.trim()) return; setManContacts(p => [...p, { ...newC }]); setNewC({ name: "", title: "", dept: "", linkedinUrl: "", type: "alumni" }); };

  const STEPS = ["Job Details", "Contacts", "Order", "Resume", "Preview", "Emails"];

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="hdr-brand">
            <div className="mono">SZ</div>
            <div><div className="brand-t">Job Search</div><div className="brand-s">Sara de Zárraga</div></div>
          </div>
          <nav className="nav">
            <button className={`nb ${view === "dashboard" ? "nb-act" : "nb-ghost"}`} onClick={() => setView("dashboard")}>Dashboard</button>
            <button className={`nb ${view === "new" ? "nb-act" : "nb-ghost"}`} onClick={() => { setView("new"); setStep(0); }}>+ New Application</button>
            <button className={`nb ${view === "settings" ? "nb-act" : "nb-ghost"}`} onClick={() => setView("settings")}>Settings</button>
          </nav>
        </header>

        {loading && (
          <div className="lov"><div className="lc"><div className="ls" /><div className="lm">{loadMsg}</div><div className="ls2">This may take a moment</div></div></div>
        )}

        <main className="main">
          {view === "dashboard" && (
            <>
              <div className="flex-bw mb28">
                <div><div className="pg-t">Applications</div><div className="pg-s">Track every outreach. Nothing falls through.</div></div>
                <button className="btn btn-pri" onClick={() => { setView("new"); setStep(0); }}>+ New Application</button>
              </div>
              <div className="stats">
                {[{ l: "Total Applied", v: stats.total }, { l: "Active Sequences", v: stats.active }, { l: "Responses", v: stats.responses }, { l: "Need Attention", v: stats.attention, red: true }].map((s, i) => (
                  <div key={i} className="stat"><div className="stat-l">{s.l}</div><div className="stat-v" style={s.red && s.v > 0 ? { color: "#aa3322" } : {}}>{s.v}</div></div>
                ))}
              </div>
              {alerts.map(a => (
                <div key={a.id} className={`alert ${a.type === "ok" ? "al-ok" : "al-warn"}`}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{a.type === "ok" ? "💬" : "⚠️"}</span>
                  <div style={{ flex: 1 }}>
                    {a.msg}
                    {a.canResume && <div className="al-acts">
                      <button className="al-btn" onClick={() => setAndSaveJobs(jobs.map(j => j.id === a.jobId ? { ...j, status: "active" } : j))}>Resume Sequence</button>
                      <button className="al-btn" onClick={() => setAndSaveJobs(jobs.map(j => j.id === a.jobId ? { ...j, status: "complete" } : j))}>Close</button>
                    </div>}
                  </div>
                </div>
              ))}
              {jobs.length === 0 ? (
                <div className="tbl"><div className="empty"><div className="empty-i">📋</div><div className="empty-t">No applications yet</div><div className="empty-d">Add your first application to start tracking outreach and tailoring your resume automatically.</div><button className="btn btn-pri" onClick={() => { setView("new"); setStep(0); }}>+ New Application</button></div></div>
              ) : (
                <div className="tbl">
                  <div className="tbl-h"><span>Company / Role</span><span>Date</span><span>Status</span><span>Contacts</span><span>Sequence</span><span /></div>
                  {jobs.map(j => (
                    <div key={j.id} className="jr">
                      <div className="jr-main" onClick={() => setExpanded(expanded === j.id ? null : j.id)}>
                        <div><div className="j-co">{j.company}</div><div className="j-ro">{j.role}</div></div>
                        <div className="j-dt">{j.date}</div>
                        <div><span className={`badge b-${j.status === "needs_attention" ? "attention" : j.status || "draft"}`}>{j.status === "active" ? "● Active" : j.status === "paused" ? "⏸ Paused" : j.status === "complete" ? "✓ Complete" : j.status === "needs_attention" ? "⚠ Attention" : "Draft"}</span></div>
                        <div className="j-cc">{(j.contacts || []).length} contact{(j.contacts || []).length !== 1 ? "s" : ""}</div>
                        <div className="j-cc">{(j.contacts || []).filter(c => ["sent", "replied"].includes(c.status)).length} / {(j.contacts || []).length} sent</div>
                        <button className="exp-btn" onClick={e => { e.stopPropagation(); setExpanded(expanded === j.id ? null : j.id); }}>{expanded === j.id ? "▲" : "▼"}</button>
                      </div>
                      {expanded === j.id && (
                        <div className="jd-detail">
                          {j.coreSkills?.length > 0 && <div className="mb20"><div className="dl mt16">Why this role — {j.role} at {j.company}</div><div className="sk-grid mt8">{j.coreSkills.map((s, i) => <div key={i} className="sk"><div className="sk-t">{s.title}</div><div className="sk-d">{s.desc}</div></div>)}</div></div>}
                          <div className="d-grid">
                            <div>
                              <div className="dl">Outreach Sequence</div>
                              {(j.contacts || []).map((c, i) => (
                                <div key={i} className="cdr">
                                  <div className="cn">{i + 1}</div>
                                  <div className="ci"><div className="c-n">{c.name}</div><div className="c-s">{c.title}{c.dept ? ` · ${c.dept}` : ""}</div>{c.email && <div className="c-s" style={{ fontFamily: "monospace", fontSize: 10 }}>{c.email}</div>}{c.altFailed && <div className="c-s" style={{ color: "#aa6600" }}>⚠ Alt format used</div>}</div>
                                  <div className={`dot d-${c.status === "pending" ? "p" : c.status === "sent" ? "s" : c.status === "replied" ? "r" : c.status === "bounced" ? "b" : "nr"}`} />
                                  <span style={{ fontSize: 10, color: "var(--ink-l)", textTransform: "capitalize" }}>{c.status}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="dl">Resume Used</div>
                              <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: "var(--rs)", padding: "8px 12px", fontSize: 13, marginBottom: 8 }}>📄 Tailored Resume — {j.company}</div>
                              {j.tailoredResume && <div className="r-prev" style={{ maxHeight: 180, fontSize: 11 }}>{j.tailoredResume.slice(0, 600)}…</div>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {view === "new" && (
            <>
              <div className="flex-bw mb28">
                <div><div className="pg-t">New Application</div><div className="pg-s">Nothing sends without your approval.</div></div>
                <button className="btn btn-gh" onClick={() => setView("dashboard")}>← Back</button>
              </div>
              <div className="steps mb28">
                {STEPS.map((label, i) => (
                  <div key={i} className="s-item">
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div className={`s-dot ${i < step ? "done" : i === step ? "active" : ""}`}>{i < step ? "✓" : i + 1}</div>
                      <div className="s-lbl">{label}</div>
                    </div>
                    {i < STEPS.length - 1 && <div className={`s-line ${i < step ? "done" : ""}`} />}
                  </div>
                ))}
              </div>
              <div className="wf">
                <div className="wf-h"><div className="wf-t">{STEPS[step]}</div><div className="wf-sl">Step {step + 1} of 5</div></div>
                <div className="wf-b">
                  {step === 0 && (
                    <>
                      <div className="f-row">
                        <div className="fg"><label className="fl">Company *</label><input className="fi" value={company} onChange={e => setCompany(e.target.value)} placeholder="HubSpot" /></div>
                        <div className="fg"><label className="fl">Role Title *</label><input className="fi" value={role} onChange={e => setRole(e.target.value)} placeholder="Group Product Manager" /></div>
                      </div>
                      <div className="fg"><label className="fl">Job Posting URL</label><input className="fi" value={jdUrl} onChange={e => setJdUrl(e.target.value)} placeholder="https://…" /><div className="fh">Or paste the job description below</div></div>
                      <div className="fg"><label className="fl">Job Description</label><textarea className="fi fta" value={jdText} onChange={e => setJdText(e.target.value)} placeholder="Paste the full job description here…" /></div>
                      <div className="btn-row"><button className="btn btn-pri" onClick={step1} disabled={(!jdText.trim() && !jdUrl.trim()) || !company.trim() || !role.trim()}>Analyze & Find Contacts →</button></div>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      {skills.length > 0 && <div className="mb20"><div className="dl">Why I'll tailor your resume this way — {role} at {company}</div><div className="sk-grid mt8">{skills.map((s, i) => <div key={i} className="sk"><div className="sk-t">{s.title}</div><div className="sk-d">{s.desc}</div></div>)}</div></div>}
                      <div className="divider" />
                      <div className="mb20">
                        <div className="dl">First-Degree Connections at {company}{fdMatches.length === 0 ? " — None found" : ""}</div>
                        {fdMatches.length > 0 ? fdMatches.map((c, i) => (
                          <div key={i} className={`ccr ${selFd[i] ? "sel" : ""}`} onClick={() => setSelFd(p => ({ ...p, [i]: !p[i] }))}>
                            <input type="checkbox" checked={!!selFd[i]} onChange={() => {}} />
                            <div><div className="txt-b" style={{ fontSize: 14 }}>{c.fullName}</div><div className="txt-sm">{c.title}{c.company ? ` · ${c.company}` : ""}</div></div>
                          </div>
                        )) : <div className="txt-sm mb12">{liContacts.length === 0 ? "Upload your LinkedIn CSV in Settings." : `No connections found at ${company}.`}</div>}
                      </div>
                      <div className="divider" />
                      <div>
                        <div className="dl">Add Alumni or Additional Contacts</div>
                        <div className="fh mb12">Add HBS/Wellesley alumni or others you found on LinkedIn.</div>
                        {manContacts.map((c, i) => (
                          <div key={i} className="ccr sel"><span>👤</span><div style={{ flex: 1 }}><div className="txt-b" style={{ fontSize: 13 }}>{c.name}</div><div className="txt-sm">{c.title}{c.dept ? ` · ${c.dept}` : ""} · {c.type.replace("_", " ")}</div></div><button className="btn btn-gh" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setManContacts(p => p.filter((_, j) => j !== i))}>✕</button></div>
                        ))}
                        <div className="acf">
                          <div className="f-row">
                            <div className="fg"><label className="fl">Full Name *</label><input className="fi" value={newC.name} onChange={e => setNewC(p => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" /></div>
                            <div className="fg"><label className="fl">Title</label><input className="fi" value={newC.title} onChange={e => setNewC(p => ({ ...p, title: e.target.value }))} placeholder="Senior PM" /></div>
                          </div>
                          <div className="f-row">
                            <div className="fg"><label className="fl">Department</label><input className="fi" value={newC.dept} onChange={e => setNewC(p => ({ ...p, dept: e.target.value }))} placeholder="Product" /></div>
                            <div className="fg"><label className="fl">Relationship</label>
                              <select className="fi" value={newC.type} onChange={e => setNewC(p => ({ ...p, type: e.target.value }))}>
                                <option value="alumni">HBS / Wellesley Alum</option>
                                <option value="first_degree">1st Degree Connection</option>
                                <option value="both">Both (Connection + Alum)</option>
                              </select>
                            </div>
                          </div>
                          <div className="fg"><label className="fl">LinkedIn URL</label><input className="fi" value={newC.linkedinUrl} onChange={e => setNewC(p => ({ ...p, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/…" /></div>
                          <button className="btn btn-sec" onClick={addManual} disabled={!newC.name.trim()}>+ Add Contact</button>
                        </div>
                      </div>
                      <div className="btn-row">
                        <button className="btn btn-gh" onClick={() => setStep(0)}>← Back</button>
                        <button className="btn btn-pri" onClick={step2} disabled={Object.values(selFd).filter(Boolean).length === 0 && manContacts.length === 0}>Confirm Contacts →</button>
                      </div>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <div className="dl mb12">Drag to reorder. First contact is emailed immediately when you launch.</div>
                      {ordered.map((c, i) => (
                        <div key={`${c.name}-${i}`} className="si" draggable onDragStart={() => onDragStart(i)} onDragOver={e => onDragOver(e, i)} onDragEnd={onDragEnd}>
                          <span style={{ color: "var(--ink-l)", fontSize: 16 }}>⠿</span>
                          <div className="sn">{i + 1}</div>
                          <div className="si-info"><div className="si-name">{c.name}</div><div className="si-sub">{c.title}{c.dept ? ` · ${c.dept}` : ""}</div></div>
                          <span className={`tb ${c.type === "first_degree" ? "tb-fd" : c.type === "both" ? "tb-bt" : "tb-al"}`}>{c.type === "first_degree" ? "1st Degree" : c.type === "both" ? "1st + Alum" : "Alum"}</span>
                        </div>
                      ))}
                      <div className="btn-row"><button className="btn btn-gh" onClick={() => setStep(1)}>← Back</button><button className="btn btn-pri" onClick={step3}>Tailor Resume →</button></div>
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <div className="flex-bw mb12">
                        <div className="dl">Tailored Resume — {company}</div>
                        <button className="btn btn-gh" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => setEditResume(!editResume)}>{editResume ? "Preview" : "✏ Edit"}</button>
                      </div>
                      {editResume ? <textarea className="r-edit" value={tailored} onChange={e => setTailored(e.target.value)} /> : <div className="r-prev" dangerouslySetInnerHTML={{__html: renderMarkdown(tailored)}} />}
                      <div className="btn-row"><button className="btn btn-gh" onClick={() => setStep(2)}>← Back</button><button className="btn btn-pri" onClick={saveResumeToDrive}>Approve Text & Save Resume →</button></div>
                    </>
                  )}
                  {step === 4 && (
                    <>
                      <div className="dl" style={{marginBottom:12}}>Review your tailored resume before sending. Open both files and confirm the formatting looks right.</div>
                      {driveLinks.docxUrl ? (
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",margin:"16px 0"}}>
                          <a href={driveLinks.docxUrl} target="_blank" rel="noreferrer" className="btn btn-sec">📄 Open Word Doc in Drive ↗</a>
                          <a href={driveLinks.pdfUrl} target="_blank" rel="noreferrer" className="btn btn-sec">📋 Open PDF in Drive ↗</a>
                        </div>
                      ) : (
                        <div className="txt-sm" style={{margin:"16px 0",color:"#aa3322"}}>Resume files not saved yet.</div>
                      )}
                      <div style={{background:"var(--gold-p)",border:"1px solid var(--border)",borderRadius:"var(--rs)",padding:"14px 16px",fontSize:13,color:"var(--ink-l)",marginBottom:16}}>
                        ✓ The Word doc and PDF are saved to your <strong>Job Search App / Resumes</strong> folder in Google Drive.<br/>Open them above to confirm the formatting looks correct before emails are sent.
                      </div>
                      <div className="btn-row">
                        <button className="btn btn-gh" onClick={() => setStep(3)}>← Back to Edit</button>
                        <button className="btn btn-pri" onClick={step5}>Looks Good — Draft Emails →</button>
                      </div>
                    </>
                  )}

                  {step === 5 && (
                    <>
                      <div className="dl mb12">Review each email. Edit if needed. 24-hour intervals between sends.</div>
                      {drafts.map((d, i) => (
                        <div key={i} className="em-card">
                          <div className="em-h">
                            <div className="em-to"><strong>To:</strong> {d.contact.name}{d.contact.title ? ` (${d.contact.title}` : ""}{d.contact.dept ? `, ${d.contact.dept}` : ""}{d.contact.title ? ")" : ""} · {company}</div>
                            <button className="btn btn-gh" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => { const u = [...drafts]; u[i] = { ...u[i], editing: !u[i].editing }; setDrafts(u); }}>{d.editing ? "Done" : "✏ Edit"}</button>
                          </div>
                          {d.editing ? <><textarea style={{ width: "100%", minHeight: 140, padding: "12px 16px", border: "none", borderBottom: "1px solid var(--border)", fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: "none", resize: "vertical", lineHeight: 1.6 }} value={d.edited} onChange={e => { const u = [...drafts]; u[i] = { ...u[i], edited: e.target.value }; setDrafts(u); }} /><div style={{display:"flex",justifyContent:"flex-end",padding:"6px 12px",gap:8}}><button className="btn btn-sec" style={{fontSize:12}} onClick={saveAsTemplate}>💾 Save as Template</button><button className="btn btn-gh" style={{fontSize:12}} onClick={() => { const u = [...drafts]; u[i] = { ...u[i], editing: false }; setDrafts(u); }}>Done ✓</button></div></> : <div className="em-b">{d.edited}</div>}
                          <div className="em-ft">📎 Tailored Resume — {company}.pdf · attached</div>
                        </div>
                      ))}
                      <div className="btn-row">
                        <button className="btn btn-gh" onClick={() => setStep(4)}>← Back</button>
                        <button className="btn btn-sec" onClick={saveAsTemplate} style={{marginRight:8}}>💾 Save as Template</button>
                        <button className="btn btn-pri" onClick={launch}>🚀 Launch Sequence</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {view === "settings" && <SettingsView hunterKey={hunterKey} liContacts={liContacts} gmailConnected={gmailConnected} onSave={(k, l) => { setHunterKey(k); setLiContacts(l); save(undefined, k, l); }} />}
        </main>
      </div>
    </>
  );
}

function SettingsView({ hunterKey, liContacts, gmailConnected, onSave }) {
  const [k, setK] = useState(hunterKey);
  const [contacts, setContacts] = useState(liContacts);
  const [saved, setSaved] = useState(false);
  const ref = useRef();
  const handleCSV = e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setContacts(parseCSV(ev.target.result)); r.readAsText(f); };
  return (
    <>
      <div className="flex-bw mb28"><div><div className="pg-t">Settings</div><div className="pg-s">API keys and data sources.</div></div></div>
      <div className="sg">
        <div className="ss"><div className="ss-t">Hunter.io API Key</div><div className="fg"><label className="fl">API Key</label><input className="fi" type="password" value={k} onChange={e => setK(e.target.value)} /><div className="fh">25 lookups/month on free plan.</div></div></div>
        <div className="ss"><div className="ss-t">LinkedIn Contacts CSV</div>
          <div className={`upz ${contacts.length > 0 ? "has" : ""}`} onClick={() => ref.current?.click()}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{contacts.length > 0 ? "✅" : "📤"}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-l)" }}>{contacts.length > 0 ? `${contacts.length} contacts loaded` : "Upload Connections.csv"}</div>
            <div style={{ fontSize: 11, color: "var(--ink-l)", marginTop: 4 }}>{contacts.length > 0 ? "Click to replace" : "LinkedIn → Settings → Data Privacy → Get a copy of your data"}</div>
            <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSV} />
          </div>
        </div>
        <div className="ss"><div className="ss-t">Google Drive Documents</div><div style={{ fontSize: 13, color: "var(--ink-l)", lineHeight: 1.8 }}><div>📄 <strong>Master Resume</strong> — connected</div><div>📄 <strong>Source Material for Resume Tailoring</strong> — connected</div><div>📄 <strong>Resume Tailoring Rules</strong> — connected</div><div style={{ marginTop: 10, fontSize: 11 }}>Update directly in Google Drive. Changes reflect automatically.</div></div></div>
        <div className="ss">
          <div className="ss-t">Gmail</div>
          <div style={{fontSize:13,color:"var(--ink-l)",lineHeight:1.7,marginBottom:12}}>Connect your Gmail account so the app can send emails on your behalf with your resume attached.</div>
          {gmailConnected === null && <div style={{fontSize:13,color:"var(--ink-l)"}}>Checking connection…</div>}
          {gmailConnected === true && (
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{color:"#2a7a4b",fontWeight:600,fontSize:13}}>✓ Gmail connected</span>
              <a href="/.netlify/functions/gmail-auth-start" className="btn btn-gh" style={{fontSize:12,textDecoration:"none"}}>Reconnect</a>
            </div>
          )}
          {gmailConnected === false && (
            <a href="/.netlify/functions/gmail-auth-start" className="btn btn-pri" style={{display:"inline-block",textDecoration:"none"}}>Connect Gmail →</a>
          )}
        </div>
        <div className="ss"><div className="ss-t">Career Coach Access</div><div style={{ fontSize: 13, color: "var(--ink-l)", lineHeight: 1.7, marginBottom: 12 }}>Share a read-only view of your dashboard with your coach.</div><button className="btn btn-sec">📋 Copy Coach View Link</button></div>
      </div>
      <div className="btn-row mt16"><button className="btn btn-pri" onClick={() => { onSave(k, contacts); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>{saved ? "✓ Saved" : "Save Settings"}</button></div>
    </>
  );
}
