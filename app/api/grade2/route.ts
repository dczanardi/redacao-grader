// @ts-nocheck
// app/api/grade2/route.ts
// app/api/grade2/route.ts
export const runtime = "nodejs";            // função Node (não edge)
export const dynamic = "force-dynamic";     // não pré-render
export const maxDuration = 90;              // Pro permite até 90s
export const preferredRegion = ["gru1","iad1"]; // SP e fallback na costa leste

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

console.log("[grade2] route module loaded");

// ====== CONFIGS ======
const LEVEL_MAP = [0.1, 0.3, 0.5, 0.7, 0.9, 1.0]; // N0..N5
const RUBRICS_DIR = path.join(process.cwd(), "rubrics");
const FUVEST_WEIGHTS: Record<string, number> = { C1: 0.40, C2: 0.30, C3: 0.15, C4: 0.15 };

// Cache DEV
const CACHE_FILE = path.join(process.cwd(), ".cache", "grades.json");
const USE_FILE_CACHE = !process.env.VERCEL;

const S = (v: any) => (v == null ? "" : String(v));
const isFile = (f?: File | null) => !!f && typeof (f as any).arrayBuffer === "function";

// ====== UTIL: CACHE DEV ======
async function ensureCacheDir() { if (!USE_FILE_CACHE) return; try { await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }); } catch {} }
async function loadCache(): Promise<Record<string, any>> { if (!USE_FILE_CACHE) return {}; try { return JSON.parse(await fs.readFile(CACHE_FILE, "utf8")); } catch { return {}; } }
async function saveCache(cache: Record<string, any>) { if (!USE_FILE_CACHE) return; try { await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8"); } catch {} }

// ====== GET ======
export async function GET() {
  return NextResponse.json({ ok: true, ping: "grade2", levelMap: LEVEL_MAP });
}

// ====== NORMALIZAÇÃO DO TEXTO ======
function normalizeEssayText(input: string) {
  let t = S(input).replace(/\r\n?/g, "\n");
  t = t.replace(/^\s*\(\d{1,3}\)\s*/gm, ""); // remove (12)
  t = t.replace(/-\s*\n\s*/g, "");          // desfaz hifenização
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t.trim();
}

// ====== SUAVIZAR TEXTO PARA O ALUNO ======
function softenStudentFacing(text: string): string {
  if (!text) return text;

  // Frases típicas em caixa alta vindas do modelo
  let out = text;

  // “SEM REPERTÓRIO, NÃO ATRIBUIR ACIMA DO NÍVEL X”
  out = out.replace(/SEM REPERT[ÓO]RIO[^.,;]*N[ÍI]VEL\s*(\d)/gi,
    (_, n) => `Sem repertório verificável; por isso, este critério foi limitado ao nível ${n}.`);

  // “NÃO pode ultrapassar o nível X”
  out = out.replace(/N[ÃA]O\s+PODE\s+ULTRAPASSAR\s+O\s+N[ÍI]VEL\s*(\d)/gi,
    (_, n) => `foi avaliado até o nível ${n}.`);

  // “REPERTORIO_OBRIGATORIO”
  out = out.replace(/REPERT[ÓO]RIO[_ ]?OBRIGAT[ÓO]RIO/gi, "repertório obrigatório");

  // Se ainda sobrarem sequências gritadas, abaixa o tom sem afetar siglas curtas
  out = out.replace(/\b([A-ZÁÂÃÉÊÍÓÔÕÚÇ]{6,})([A-ZÁÂÃÉÊÍÓÔÕÚÇa-z0-9 ,.;:!?”")])/g,
    (m) => m.charAt(0) + m.slice(1).toLowerCase());

  return out;
}

// ====== CARREGAR RÚBRICA ======
async function loadRubricFile(rubricNameRaw: string) {
  const safe = rubricNameRaw
    .replace(/\s*\((oficial|operacional)\)\s*/ig, "")
    .replace(/\bVUNESP\b/ig, "UNESP");

  const files = await fs.readdir(RUBRICS_DIR);
  const fileName = files.find(f => f.replace(/\.json$/i, "").toLowerCase() === safe.toLowerCase());
  if (!fileName) throw new Error(`Rubrica não encontrada: ${safe} (confira arquivos .json em /rubrics)`);

  const raw = await fs.readFile(path.join(RUBRICS_DIR, fileName), "utf8");
  let json: any; try { json = JSON.parse(raw); } catch (e:any) { throw new Error(`JSON inválido em ${fileName}: ${e?.message || e}`); }

  let items: any[] = [];
  let rules: any[] = [];

  if (Array.isArray(json)) items = json;
  else {
    if (Array.isArray(json.items)) items = json.items;
    else if (Array.isArray(json.criteria)) items = json.criteria;
    else if (json && typeof json === "object") {
      const entries = Object.entries(json).filter(([k]) => k !== "name" && k !== "rules");
      if (entries.length) {
        items = entries.map(([key, val]: [string, any], idx) => {
          if (val && typeof val === "object") {
            let w = Number(val.weight ?? val.peso ?? val.weight_pct ?? 0);
            if (w > 1) w = w / 100;
            return {
              id: val.id || key,
              name: val.name || val.title || val.label || key,
              weight: isNaN(w) ? 0 : w,
              description: val.description || val.desc || "",
              levels: val.levels || undefined
            };
          } else {
            const w = Number(val);
            return { id: key, name: key, weight: isNaN(w) ? 0 : (w > 1 ? w / 100 : w) };
          }
        });
      }
    }
    rules = Array.isArray(json.rules) ? json.rules : [];
  }

  items = items.map((it: any, idx: number) => {
    const id  = it.id || it.code || it.key || `C${idx + 1}`;
    const name = it.name || it.title || it.label || id;
    let w = Number(it.weight ?? it.peso ?? it.weight_pct ?? 0);
    if (w > 1) w = w / 100;
    if (!isFinite(w)) w = 0;
    const levels = it.levels && typeof it.levels === "object" ? it.levels : undefined;
    return { id, name, weight: w, description: it.description || it.desc || "", levels };
  });

  // pesos oficiais FUVEST
  if (safe.toUpperCase() === "FUVEST") {
    items = items.map((it: any) =>
      (FUVEST_WEIGHTS[it.id] != null) ? { ...it, weight: FUVEST_WEIGHTS[it.id] } : it
    );
  }

  const sum = items.reduce((s: number, it: any) => s + (Number(it.weight) || 0), 0);
  const normalized = (sum > 0)
    ? items.map((it: any) => ({ ...it, weight: (Number(it.weight) || 0) / sum }))
    : items;

  normalized.sort((a,b)=> S(a.id).localeCompare(S(b.id), "pt-BR", {numeric:true}));

  return { name: json.name || safe, items: normalized, rules };
}

// ====== PROPOSTA: texto/imagem ======
async function getProposalText(form: FormData) {
  const text = S(form.get("proposal_text") || "").trim();
  const file = form.get("proposal_file") as File | null;
  if (!isFile(file)) return { text: text || undefined };

  const mime = (file!.type || "").toLowerCase();
  const bytes = await file!.arrayBuffer();

  if (mime === "application/pdf" || /\.pdf$/i.test(file!.name || "")) {
    let pdfParse: any = null;
    try { pdfParse = (await import("pdf-parse")).default; } catch {}
    if (pdfParse) {
      try {
        const data = await pdfParse(Buffer.from(bytes));
        const txt = S(data.text || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
        if (txt) return { text: txt };
      } catch (e:any) { console.error("[grade2] pdf-parse error:", e?.message); }
    }
    return { text: text || undefined };
  }

  if (mime.startsWith("image/")) {
    const b64 = Buffer.from(bytes).toString("base64");
    return { imageDataUrl: `data:${mime};base64,${b64}`, text: text || undefined };
  }
  return { text: text || undefined };
}

// ====== RÚBRICA EM TEXTO ======
function rubricToStrictText(r: any) {
  const lines: string[] = [];
  lines.push(`Rúbrica: ${r.name}`);
  lines.push(`Critérios (id | nome | peso% | níveis 0..5):`);
  r.items.forEach((it:any) => {
    const w = (it.weight*100).toFixed(0);
    lines.push(`- ${it.id} | ${it.name} | ${w}%`);
    if (it.levels) {
      for (let lv=0; lv<=5; lv++) {
        const desc = it.levels[String(lv)];
        if (desc) lines.push(`  nível ${lv}: ${desc}`);
      }
    }
  });
  if (Array.isArray(r.rules) && r.rules.length) {
    lines.push(`Regras duras (aplicar sempre que a condição ocorrer):`);
    r.rules.forEach((rw:any) => {
      lines.push(`- [${rw.id}] tipo=${rw.type} alvo=${(rw.criterion_ids||[]).join(",")} ` +
                 `${rw.max_level != null ? "max_level="+rw.max_level : ""} ` +
                 `${rw.min_level != null ? "min_level="+rw.min_level : ""}`);
      if (rw.when) lines.push(`  Quando: ${rw.when}`);
    });
  }
  return lines.join("\n");
}

// ====== CHAMADA AO MODELO (sem temperature) ======
async function callModelStrict({ rubric, proposalText, proposalImageDataUrl, essayText }: any) {
  const { OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const rubricText = rubricToStrictText(rubric);

  const messages: any[] = [
    {
      role: "system",
      content:
        "Você é um corretor que segue a rúbrica à risca. " +
        "Atribua nível inteiro 0..5 por critério exclusivamente com base nas descrições e regras. " +
        "Use 5 somente quando o desempenho atende plenamente; aplique caps quando uma regra exigir. " +
        "Retorne JSON válido, ordenado por 'id'."
    },
    {
      role: "user",
      content:
        rubricText + "\n\n" +
        "Mapa de nível (0..5 → valor 0..1): [0.1,0.3,0.5,0.7,0.9,1.0].\n" +
        "Formato de saída JSON (e nada além disso):\n{\n" +
        "  \"criteria\": [ {\"id\":\"C1\",\"name\":\"...\",\"level\":3,\"just\":\"...\"}, ... ],\n" +
        "  \"suggestions\": [\"...\",\"...\"],\n" +
        "  \"triggered_rules\": [ {\"id\":\"no_common_sense\",\"criterion_ids\":[\"C2\"],\"reason\":\"...\"} ]\n" +
        "}\n" +
        "Observações:\n" +
        "- 'criteria' deve conter TODOS os critérios da rúbrica, ordenados por id (C1,C2,...).\n" +
        "- 'level' é inteiro 0..5. Se uma 'rule' exigir limite (cap/min), respeite.\n" +
        "- 'just' deve ser clara e cordial (linguagem para o aluno), sem comandos internos em CAIXA ALTA.\n"
    }
  ];

  if (proposalText) messages.push({ role: "user", content: `Texto da PROPOSTA (se relevante):\n"""${proposalText}"""` });
  if (proposalImageDataUrl) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: "Imagem da PROPOSTA (considere enunciado/elementos visuais):" },
        { type: "image_url", image_url: { url: proposalImageDataUrl } } as any,
      ] as any,
    });
  }
  messages.push({ role: "user", content: `TEXTO DO ALUNO (final):\n"""${essayText}"""` });

  const req: any = {
    model: process.env.ESSAY_MODEL || process.env.OCR_MODEL_PRIMARY || "gpt-5",
    messages,
    response_format: { type: "json_object" }
  };

// Tempo-limite interno para não encostar nos 90s da Vercel
const KILL_AFTER_MS = 70_000;

const resp = await Promise.race([
  // sua chamada atual ao modelo
  client.chat.completions.create(req),

  // “bomba-relógio” que estoura após 70s
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT_70S")), KILL_AFTER_MS)
  ),
]);

const txt = S((resp as any)?.choices?.[0]?.message?.content || "");
let data: any = null;
try {
  data = JSON.parse(txt);
} catch {
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) {
    try { data = JSON.parse(m[0]); } catch {}
  }
}
if (!data?.criteria?.length)
  throw new Error("Falha na avaliação (JSON inválido do modelo).");


  data.criteria.sort((a:any,b:any)=> S(a.id).localeCompare(S(b.id), "pt-BR", {numeric:true}));
  data.criteria = data.criteria.map((c:any)=>({
    id: S(c.id),
    name: S(c.name),
    level: Math.max(0, Math.min(5, Math.round(Number(c.level)||0))),
    just: softenStudentFacing(S(c.just||c.justification||""))
  }));
  if (!Array.isArray(data.suggestions)) data.suggestions = [];
  if (!Array.isArray(data.triggered_rules)) data.triggered_rules = [];

  // também suaviza reasons
  data.triggered_rules = data.triggered_rules.map((r:any)=>({
    ...r, reason: softenStudentFacing(S(r.reason||""))
  }));

  return data;
}

// ====== DETECÇÃO HEURÍSTICA DE REPERTÓRIO ======
type Detected = { has:boolean; hits:string[]; reason:string };
function detectRepertoire(essay: string, proposal?: string): Detected {
  const text = (essay || "") + "\n" + (proposal || "");
  const hits: string[] = [];
  const strongPatterns: Array<[RegExp,string]> = [
    [/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/g, "ano/data"],
    [/\b\d{1,3}\s?[%]\b/g, "%"],
    [/\bLei\s+n[ºo]\s?\d+/gi, "lei n°"],
    [/\bConstituição\b|\bCódigo\b|\bEstatuto\b/gi, "lei/código"],
    [/\bIBGE\b|\bONU\b|\bOMS\b|\bUNESCO\b|\bIPEA\b/gi, "instituição"],
    [/\bsegundo\b|\bde acordo com\b|\bconforme\b/gi, "marcador de citação"],
    [/\bestudo(s)?\b|\bpesquisa(s)?\b|\brelatório(s)?\b|\bestatística(s)?\b/gi, "estudo/pesquisa"],
    [/\b(Aristóteles|Platão|Durkheim|Weber|Foucault|Bauman|Habermas|Freud|Skinner|Piaget|Vygotsky|Bourdieu)\b/gi, "autor clássico"],
    [/\b(Orwell|Huxley|Kafka|Camus|Saramago|Machado de Assis|Drummond|Clarice Lispector)\b/gi, "obra/autor"]
  ];
  strongPatterns.forEach(([re,label]) => { if (re.test(text)) hits.push(label); });

  const weakPatterns: Array<[RegExp,string]> = [
    [/\b\d{2,}\b/g, "número"],
    [/"[^"]{6,}"/g, "aspas/citação"],
    [/\b(em 19\d{2}|em 20\d{2})\b/gi, "ano (fraco)"]
  ];
  let weakCount = 0; weakPatterns.forEach(([re,_]) => { if (re.test(text)) weakCount++; });

  const has = hits.length >= 1 || weakCount >= 2;
  const reason = has
    ? `Sinais de repertório detectados: ${[...hits, weakCount>=2 ? "indícios fracos" : ""].filter(Boolean).join(", ")}.`
    : "Faltou repertório verificável (autores, dados, leis, obras, estudos, casos); por isso alguns critérios podem ser limitados.";
  return { has, hits, reason };
}

// ====== HTML DO RELATÓRIO ======
function humanRuleId(id: string) {
  if (/repertorio/i.test(id)) return "Repertório obrigatório";
  return id;
}

function buildReportHTML({ rubric, result, essayText }: any) {
  let total = 0;

  const rows = result.criteria.map((c: any) => {
    const w = rubric.items.find((it:any)=>it.id===c.id)?.weight ?? 0;
    const levelVal = LEVEL_MAP[c.level];
    const nota = levelVal * (w*100);
    total += nota;
    return `<tr>
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${levelVal.toFixed(1)}</td>
      <td>${(w*100).toFixed(0)}%</td>
      <td class="right">${nota.toFixed(1)}</td>
      <td>${softenStudentFacing(S(c.just))}</td>
    </tr>`;
  }).join("");

  const suggestions = Array.isArray(result.suggestions) ? result.suggestions.slice(0,5) : [];

  const rulesBlock = (Array.isArray(result.triggered_rules) && result.triggered_rules.length)
    ? `<details open style="margin-top:12px">
         <summary><b>Regras aplicadas</b></summary>
         <ul>${result.triggered_rules.map((r:any)=>`<li><b>${humanRuleId(S(r.id))}</b> → [${(r.criterion_ids||[]).join(", ")}]: ${softenStudentFacing(S(r.reason))}</li>`).join("")}</ul>
       </details>` : "";

  const html = `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<title>Relatório - ${rubric.name}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px;color:#222;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:top}
  th{background:#f6f6f6;text-align:left}
  .right{text-align:right}
  .muted{color:#666}
  .badge{display:inline-block;padding:2px 6px;border-radius:6px;background:#eef;border:1px solid #dde}
  pre{white-space:pre-wrap;border:1px solid #eee;padding:10px;background:#fafafa}
  th.level-col{white-space:nowrap; min-width: 110px; font-weight:600;}
</style>
</head>
<body>
  <h2>Nota (0–100): ${total.toFixed(0)} <span class="badge">${rubric.name}</span></h2>

  <details open>
    <summary><b>Critérios</b></summary>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Critério</th>
          <th class="level-col">Nível (0–1.0)</th>
          <th>Peso</th>
          <th class="right">Nota</th>
          <th>Justificativa</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="4" class="right"><b>Total (antes de arredondar)</b></td>
          <td class="right"><b>${total.toFixed(1)}</b></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </details>

  <details open style="margin-top:12px">
    <summary><b>Como a nota é calculada</b></summary>
    <p class="muted" style="margin:6px 0 0 0">Nota total = soma das notas.</p>
    <p class="muted" style="margin:4px 0 0 0">Nota = nível × peso.</p>
  </details>

  ${rulesBlock}

  ${
    suggestions.length
      ? `<details open style="margin-top:12px">
           <summary><b>Sugestões de melhoria</b></summary>
           <ul>${suggestions.map((s:string)=>`<li>${s}</li>`).join("")}</ul>
         </details>` : ""
  }

  <details open style="margin-top:12px">
    <summary><b>Texto enviado (redação)</b></summary>
    <pre>${essayText.replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'} as any)[m])}</pre>
  </details>
</body>
</html>`;
  return { total, html };
}

function cacheKey(payload: any) {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

// ====== POST ======
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const rubricName = S(form.get("rubric") || "FUVEST");
    const rubric = await loadRubricFile(rubricName);

    const prop = await getProposalText(form);

    const essayText = normalizeEssayText(S(form.get("essay_text_override") || form.get("essay_text") || ""));
    if (!essayText) throw new Error("Cole o texto da redação (campo obrigatório).");

    // ====== CACHE DEV ======
    const payloadForHash = {
      rubric, proposalText: prop.text || "", proposalImage: !!prop.imageDataUrl,
      essayText, levelMap: LEVEL_MAP, model: process.env.ESSAY_MODEL || process.env.OCR_MODEL_PRIMARY || "gpt-5",
      version: "v3.2-soft-student"
    };
    const key = cacheKey(payloadForHash);
    await ensureCacheDir();
    let cache = await loadCache();
    if (cache[key]) return NextResponse.json(cache[key]);

    // ====== AVALIAÇÃO ======
    const result = await callModelStrict({
      rubric,
      proposalText: prop.text,
      proposalImageDataUrl: prop.imageDataUrl,
      essayText,
    });

    // ====== PARA-CHOQUE: CAP SE NÃO HÁ REPERTÓRIO ======
    const det = detectRepertoire(essayText, prop.text);
    let autoTriggered = false;

    if (!det.has) {
      const c2 = result.criteria.find((c:any) => c.id.toUpperCase() === "C2" || /argumenta/i.test(c.name));
      if (c2 && c2.level > 2) {
        c2.level = 2;
        c2.just = softenStudentFacing(`Faltou repertório verificável; por isso, este critério foi limitado ao nível 2. ${c2.just}`);
        autoTriggered = true;
      }
      const c1 = result.criteria.find((c:any) => c.id.toUpperCase() === "C1" || /tema|gênero|genero/i.test(c.name));
      if (c1 && c1.level > 3) {
        c1.level = 3;
        c1.just = softenStudentFacing(`Faltou repertório verificável; por isso, este critério foi avaliado até o nível 3. ${c1.just}`);
        autoTriggered = true;
      }

      if (autoTriggered) {
        result.triggered_rules = result.triggered_rules || [];
        result.triggered_rules.push({
          id: "repertorio_obrigatorio_auto",
          criterion_ids: [ result.criteria.find((c:any)=>c.id.toUpperCase()==="C1")?.id || "C1",
                           result.criteria.find((c:any)=>c.id.toUpperCase()==="C2")?.id || "C2" ],
          reason: det.reason
        });
      }
    }

    // ====== RELATÓRIO ======
    const outData = buildReportHTML({ rubric, result, essayText });
    const response = {
      ok: true,
      total: outData.total,
      report_html: outData.html,
      levelMap: LEVEL_MAP,
      triggered_rules: result.triggered_rules || [],
      repertoire_detected: det
    };

    cache[key] = response;
    await saveCache(cache);
    return NextResponse.json(response);
  } catch (e: any) {
    console.error("[grade2] POST error:", e);
    return NextResponse.json({ error: e?.message || "Falha na avaliação" }, { status: 500 });
  }
}