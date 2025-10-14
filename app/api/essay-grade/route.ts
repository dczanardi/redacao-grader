// @ts-nocheck
// app/api/essay-grade/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

/** ---------- Patch para vision: normaliza image_url se vier como string ---------- */
/* Evita o erro 400: "Invalid type for messages[...].content[...].image_url" */
(function patchOpenAIForVision() {
  try {
    const origCreate = openai.chat.completions.create.bind(openai.chat.completions);
    // @ts-ignore
    openai.chat.completions.create = (args: any) => {
      try {
        if (Array.isArray(args?.messages)) {
          args.messages = args.messages.map((m: any) => {
            if (Array.isArray(m?.content)) {
              m.content = m.content.map((part: any) => {
                if (part?.type === "image_url" && typeof part.image_url === "string") {
                  part.image_url = { url: part.image_url };
                }
                return part;
              });
            }
            return m;
          });
        }
      } catch {/* ignore */}
      return origCreate(args);
    };
  } catch {/* ignore */}
})();

/* ============================== Utils =============================== */
const ENV = {
  OCR_PRIMARY: process.env.OCR_MODEL_PRIMARY   || "gpt-4o",
  OCR_FB1:     process.env.OCR_MODEL_FALLBACK1 || "gpt-4o-mini",
  OCR_FB2:     process.env.OCR_MODEL_FALLBACK2 || "gpt-4.1-mini",
  EVAL_MODEL:  process.env.EVAL_MODEL          || "gpt-4.1",
};

// Mapa “suave” acordado no projeto
const LEVEL_MAP: number[] = [0, 0.20, 0.40, 0.60, 0.80, 1.00];
const toWeight = (w: any) => (w > 1 ? w / 100 : Number(w || 0));
const levelNum = (x: any) => {
  const n = typeof x === "number" ? x : parseInt(String(x ?? 0), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
};
function weightedScore(criteria: any[] = []) {
  const sum = criteria.reduce(
    (s, c) => s + toWeight(c.weight) * (LEVEL_MAP[levelNum(c.level_score_native)] ?? 0),
    0
  );
  return Math.round(sum * 100);
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]!));
}

/** Remove números de linha no início e junta hifenizações de quebra */
function minimalOCREdits(input: string): string {
  const txt = String(input ?? "");
  const normalized = txt.replace(/\r\n?/g, "\n");
  const noLineNums = normalized
    .split("\n")
    .map(l => l.replace(/^\s*\(\d{1,3}\)\s*/, "")) // (12) início de linha
    .join("\n");
  const deHyphen = noLineNums.replace(/-\s*\n\s*/g, ""); // comuni-\ncação → comunicação
  return deHyphen;
}

function countNonEmptyLines(text?: string) {
  if (!text) return 0;
  return String(text).split(/\r?\n/).filter(l => l.trim().length > 0).length;
}
function applyVunespLineRules(json: any, essayText: string, rubricName?: string) {
  const name = String(rubricName || json?.institution || "").toUpperCase();
  const isVunesp = /(UNESP|VUNESP|EINSTEIN|SANTA CASA)/i.test(name);
  if (!isVunesp) return;

  const lines = countNonEmptyLines(essayText);
  for (const c of json?.criteria || []) {
    const nm = String(c?.name || "");
    let lv = levelNum(c?.level_score_native);
    if (lines <= 20 && /^[CD]\s*[—-]/i.test(nm) && lv >= 5) lv = 4;
    if (lines <= 15 && /^[CD]\s*[—-]/i.test(nm)) lv = Math.max(0, lv - 1);
    c.level_score_native = lv;
  }
}
function capByTheme(addressing?: string) {
  const s = String(addressing || "").toLowerCase();
  if (/(off[-\s]?topic|fuga de tema|fora do tema)/i.test(s)) return 20;      // off-topic
  if (/(partial|ader[eê]ncia parcial|parcial)/i.test(s)) return 60;          // parcial
  return 100;
}

/** ---------- HTML do relatório (colunas conforme requisitos) ---------- */
function renderReportHTML(json: any, essayText: string, propostaText: string) {
  const esc = escapeHtml;
  const mapStr = LEVEL_MAP.map((v, i) => `${i}→${v.toFixed(2)}`).join(", ");

  const rows = (json?.criteria || []).map((c: any) => {
    const nativeLevel = levelNum(c.level_score_native); // 0..5
    const lvlVal = LEVEL_MAP[nativeLevel] ?? 0;
    const pesoPct = Math.round(toWeight(c.weight) * 100);
    const contrib = lvlVal * toWeight(c.weight) * 100;

    return `
      <tr>
        <td>${esc(c.id || "")}</td>
        <td>${esc(c.name || "")}</td>
        <td style="text-align:center">${nativeLevel} de 5</td>
        <td style="text-align:center">${pesoPct}%</td>
        <td style="text-align:right">${contrib.toFixed(1)}</td>
        <td>${esc(c.justification || "")}</td>
      </tr>`;
  }).join("");

  const total = (json?.criteria || []).reduce((s: number, c: any) => {
    const nativeLevel = levelNum(c.level_score_native);
    const lvlVal = LEVEL_MAP[nativeLevel] ?? 0;
    return s + (lvlVal * toWeight(c.weight) * 100);
  }, 0);

  return `<!doctype html><meta charset="utf-8">
  <title>Relatório</title>
  <style>
    body{background:#0b0b0b;color:#f3f3f3;font:14px/1.5 system-ui,Segoe UI,Roboto}
    h1,h2{margin:8px 0}
    .card{border:1px solid #333;padding:12px;margin:10px 0;background:#111;border-radius:8px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid #333;padding:6px;vertical-align:top}
    th{background:#141414}
    td:nth-child(3),td:nth-child(4),td:nth-child(5){white-space:nowrap}
    pre{white-space:pre-wrap;background:#0e0e0e;padding:10px;border:1px solid #333;border-radius:6px}
    .score{font-size:18px;font-weight:700}
    .right{ text-align:right }
  </style>

  <h1>Relatório de Correção</h1>
  <div class="card"><span class="score">Nota (0–100): ${json?.final_score_0_100 ?? ""}</span></div>

  <div class="card">
    <h2>Resumo da proposta</h2>
    <p>${esc(json?.proposta_summary || "")}</p>
    <details><summary>Proposta (texto usado na avaliação)</summary><pre>${esc(propostaText || "(vazio)")}</pre></details>
  </div>

  <div class="card">
    <h2>Critérios</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Critério</th>
          <th>Nível</th>
          <th>Peso</th>
          <th>Contrib. (pts)</th>
          <th>Justificativa</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" class="right"><b>Total (antes de arredondar)</b></td>
          <td class="right"><b>${total.toFixed(1)}</b></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="card">
    <h2>Como a nota é calculada</h2>
    <ul>
      <li><b>Nível</b> (0–5) é convertido para <b>valor</b> conforme o mapa atual: ${esc(mapStr)}.</li>
      <li><b>Peso</b> é a parcela do total exibida em <b>%</b> (ex.: 25% = 0,25 do total).</li>
      <li><b>Contribuição por critério</b>: <code>valor × peso × 100</code> (mostrada na coluna “Contrib. (pts)”).</li>
      <li><b>Nota final</b> é a soma de todas as contribuições, com arredondamento.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Transcrição da redação (para conferência)</h2>
    <pre>${esc(essayText || "(vazio)")}</pre>
  </div>`;
}

/* ============================== Rubrics =============================== */
import rubricENEM       from "@/rubrics/ENEM.json";
import rubricFUVEST     from "@/rubrics/FUVEST.json";
import rubricUNICAMP    from "@/rubrics/UNICAMP.json";
import rubricUNESP      from "@/rubrics/UNESP.json";
import rubricINSPER     from "@/rubrics/INSPER.json";
import rubricPUC_SP     from "@/rubrics/PUC_SP.json";
import rubricMACKENZIE  from "@/rubrics/MACKENZIE.json";
import rubricEINSTEIN   from "@/rubrics/EINSTEIN.json";
import rubricSANTACASA  from "@/rubrics/SANTA_CASA.json";
import rubricFGV_EAESP  from "@/rubrics/FGV_EAESP.json";
import rubricFGV_EESP   from "@/rubrics/FGV_EESP.json";
import rubricFGV_DIRSP  from "@/rubrics/FGV_DIREITO_SP.json";

// CSA (internas)
import rubricCSA_EM_23                    from "@/rubrics/CSA_EM_2e3_VESTIBULARES.json";
import rubricCSA_EM_1AS                   from "@/rubrics/CSA_EM_1AS.json";
import rubricCSA_EM_GERAL                 from "@/rubrics/CSA_EM_GERAL.json";
import rubricCSA_EM_VEST                  from "@/rubrics/CSA_EM_VESTIBULAR.json";
import rubricCSA_6_NOTICIA                from "@/rubrics/CSA_EFAF_6_ANO_NOTICIA.json";
import rubricCSA_6_RESENHA                from "@/rubrics/CSA_EFAF_6_ANO_RESENHA_CRITICA.json";
import rubricCSA_8_CONTO                  from "@/rubrics/CSA_EFAF_8_ANO_CONTO_FANTASTICO.json";
import rubricCSA_9_EDITORIAL              from "@/rubrics/CSA_EFAF_9_ANO_EDITORIAL.json";
// OBS: Caso você tenha um 7º ano teatral no projeto, mantenha o import conforme seu arquivo real.

// Tabela de rubricas desta rota (mantendo aliases úteis)
const RUBRICS: Record<string, any> = {
  ENEM: rubricENEM,
  FUVEST: rubricFUVEST,
  UNESP: rubricUNESP,
  VUNESP: rubricUNESP, // alias (UI deve esconder “VUNESP”)
  UNICAMP: rubricUNICAMP,
  INSPER: rubricINSPER,
  PUC_SP: rubricPUC_SP,
  MACKENZIE: rubricMACKENZIE,
  EINSTEIN: rubricEINSTEIN,
  SANTA_CASA: rubricSANTACASA,
  FGV_EAESP: rubricFGV_EAESP,
  FGV_EESP: rubricFGV_EESP,
  FGV_DIREITO_SP: rubricFGV_DIRSP,

  "CSA_EM_2E3": rubricCSA_EM_23,
  "CSA_EM_1AS": rubricCSA_EM_1AS,
  "CSA_EM_GERAL": rubricCSA_EM_GERAL,
  "CSA_EM_VESTIBULAR": rubricCSA_EM_VEST,
  "CSA_EFAF_6_NOTICIA": rubricCSA_6_NOTICIA,
  "CSA_EFAF_6_RESENHA": rubricCSA_6_RESENHA,
  "CSA_EFAF_8_CONTO_FANTASTICO": rubricCSA_8_CONTO,
  "CSA_EFAF_9_EDITORIAL": rubricCSA_9_EDITORIAL,
};

/* ============================== OCR helpers =============================== */
async function ocrImage(bytes: ArrayBuffer, mime: string) {
  const base64 = Buffer.from(bytes).toString("base64");
  const models = [ENV.OCR_PRIMARY, ENV.OCR_FB1, ENV.OCR_FB2];
  let lastErr: any = null;

  for (const model of models) {
    try {
      const res = await openai.chat.completions.create({
        model,
        temperature: 0,
        top_p: 0.1,
        messages: [
          {
            role: "system",
            content:
              "Você é um OCR em pt-BR. Transcreva com máxima fidelidade, numerando as linhas (1)(2)... " +
              "Se alguma palavra estiver ilegível, use [?]. Ignore pautas e bordas.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcreva o manuscrito. Devolva como texto puro com quebras de linha." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } } as any,
            ] as any,
          },
        ],
      });
      return String(res.choices?.[0]?.message?.content || "").trim();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Falha no OCR");
}

/* ============================== Prompt do avaliador =============================== */
const EVALUATOR_SYSTEM = `Você é avaliador de redações (vestibulares brasileiros).
Responda APENAS em JSON (pt-BR) no formato:
{
 "institution": "<nome>",
 "proposta_summary": "<2-3 linhas>",
 "addressing_of_theme": "<meets|partially meets|off-topic + 1 linha>",
 "criteria": [
  {"id":"C1","name":"...","level_chosen":"<0..5 ou rótulo>","level_score_native":<0..5>,
   "weight":<0..1>,"justification":"<3–5 linhas>","evidence":["<trecho + nº de linha>"]}
 ],
 "flags": {
  "explicit_use_of_motivators": <true|false>,
  "repertorio_externo": <true|false>,
  "superficialidade": "<baixa|media|alta>"
 },
 "counts": {
  "paragrafos": <int>,
  "conectores_adequados": <int>,
  "erros_gramaticais_graves": <int>,
  "erros_gramaticais_leves": <int>
 },
 "final_score_0_100": <0..100>,
 "overall_feedback": "<5–8 linhas>",
 "actionable_edits": ["<até 6 sugestões>"]
}

Regras de severidade:
- Se NÃO houver uso explícito da coletânea/motivadores, C1 máximo = 3.
- Se NÃO houver repertório externo (além do senso comum), C3 máximo = 2.
- Se superficialidade = alta, reduza 1 nível em C1 e C3.
- Se erros graves >= 3, C4 máximo = 2; se (graves >=1 OU leves >=5), C4 máximo = 3.
- Se conectores_adequados < 6, C2 máximo = 3; se parágrafos < 4, C2 máximo = 2.

Seja conservador. Não atribua 5 a C1/C2/C4 quando houver qualquer uma das limitações acima.`;

/* ============================== Handler =============================== */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const rubricName = String(form.get("rubric") ?? "ENEM").toUpperCase();

    // Proposta: campo de texto OU arquivo (imagem) — PDF desabilitado conforme decisão de produto
    let propostaText = String(form.get("proposta") || "").trim();
    const propostaFile = form.get("proposta_file") as File | null;
    if (!propostaText && propostaFile) {
      const pBytes = await propostaFile.arrayBuffer();
      const pMime = (propostaFile.type || "").toLowerCase();
      if (pMime.startsWith("image/")) {
        try { propostaText = await ocrImage(pBytes, pMime); } catch {}
      }
    }
    if (!propostaText) {
      return NextResponse.json({ error: "Proposta não fornecida (texto ou imagem)." }, { status: 400 });
    }

    // Redação: prioridade de envio — Digitado > OCR limpo > Arquivo
    let essayText = String(form.get("essay_text_override") || "").trim();
    const file = form.get("file") as File | null;

    if (!essayText) {
      if (!file) {
        return NextResponse.json({ error: "Arquivo da redação não enviado" }, { status: 400 });
      }
      const bytes = await file.arrayBuffer();
      const mime = (file.type || "").toLowerCase();
      if (mime.includes("text") || mime.includes("word")) {
        essayText = await file.text();
      } else if (mime.startsWith("image/")) {
        essayText = await ocrImage(bytes, mime);
      } else if (mime.includes("pdf")) {
        return NextResponse.json(
          { error: "Para redação manuscrita em PDF, anexe como IMAGEM (jpg/png)." },
          { status: 400 }
        );
      } else {
        return NextResponse.json({ error: "Tipo de arquivo não suportado." }, { status: 400 });
      }
    }

    // Rubrica
    const rubric = RUBRICS[rubricName] ?? RUBRICS["ENEM"];

    // Texto que vai ao modelo (sem numeração e sem hifenização de quebra)
    const essayTextForEval = minimalOCREdits(essayText);

    // Avaliação
    const evalRes = await openai.chat.completions.create({
      model: ENV.EVAL_MODEL,
      temperature: 0,
      top_p: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EVALUATOR_SYSTEM },
        { role: "user", content: `RUBRIC_JSON:\n${JSON.stringify(rubric)}` },
        { role: "user", content: `PROPOSTA:\n${propostaText}` },
        { role: "user", content: `ESSAY_TEXT:\n${essayTextForEval}` },
      ],
    });

    let resultJSON: any = {};
    try {
      resultJSON = JSON.parse(evalRes.choices[0]?.message?.content || "{}");
    } catch {
      return NextResponse.json({ error: "Modelo não retornou JSON válido" }, { status: 500 });
    }

    // Regras extras (caps, linhas Vunesp)
    const cap = capByTheme(resultJSON.addressing_of_theme);
    applyVunespLineRules(resultJSON, essayText, rubricName);

    // Nota final: recalculada com LEVEL_MAP “suave” + cap temático
    const rawScore = weightedScore(resultJSON.criteria);
    resultJSON.final_score_0_100 = Math.min(rawScore, cap);

    // HTML
    const html = renderReportHTML(resultJSON, essayText, propostaText);

    return NextResponse.json({
      score: resultJSON.final_score_0_100,
      report_html: html,
    });
  } catch (err: any) {
    console.error("essay-grade fatal:", err);
    return NextResponse.json({ error: err?.message || "Erro interno" }, { status: 500 });
  }
}