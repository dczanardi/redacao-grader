// @ts-nocheck
// app/api/essay-grade-lite-pretty/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

/* ---------------- util ---------------- */
const stripBOM = (s: string) => s.replace(/^\uFEFF/, "");
function tryParseJSONLoose(raw: string): any | null {
  try { return JSON.parse(stripBOM(raw)); } catch {}
  const cleaned = stripBOM(raw).replace(/[\u0000-\u001F]+/g, " ").trim();
  try { return JSON.parse(cleaned); } catch {}
  const i = cleaned.indexOf("{"), j = cleaned.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(cleaned.slice(i, j + 1)); } catch {} }
  return null;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m] as string));
}
const looksLikeReport = (o: any) => !!o && (o.criteria || o.institution || o.actionable_edits);
function extractScore(a: any, b?: any) {
  if (typeof a?.final_score_0_100 === "number") return a.final_score_0_100;
  if (typeof a?.score === "number") return a.score;
  if (typeof b?.final_score_0_100 === "number") return b.final_score_0_100;
  if (typeof b?.score === "number") return b.score;
  return undefined;
}
function withTimeout<T>(p: Promise<T>, ms: number, msg="TIMEOUT"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
const clip = (s: string, n=200) => (s || "").slice(0, n);
function limitReason(s: string, n=1000) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/* ---------------- OCR (Chat Completions vision) ---------------- */
async function visionOCRFromBuffer(buf: Buffer, mime: string, userText: string): Promise<string> {
  const b64 = buf.toString("base64");
  const res = await withTimeout(
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "Você é um OCR cuidadoso. Transcreva o TEXTO, fielmente. Não invente. Apenas texto." },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mime || "image/png"};base64,${b64}` } }
          ]
        }
      ]
    }),
    90000,
    "VISION_TIMEOUT"
  );
  return String(res?.choices?.[0]?.message?.content || "").trim();
}

/* ---------------- proposta: imagem→OCR ---------------- */
async function readProposalFromFile(file: File): Promise<{ text: string, source: "img_ocr"|"unknown" }> {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (type.startsWith("image/") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    try {
      const t = await visionOCRFromBuffer(
        buf,
        type || "image/png",
        "Extraia a proposta/tema com os textos motivadores. Se houver várias páginas, mantenha a ordem. Apenas texto."
      );
      if (t && t.replace(/\s+/g, " ").length >= 10) return { text: t, source: "img_ocr" };
    } catch {}
  }
  return { text: "", source: "unknown" };
}

/* ---------------- redação: imagem→OCR p/ exibir transcrição ---------------- */
async function readEssayTranscriptionForDisplay(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (!(type.startsWith("image/") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) {
    return "";
  }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const t = await visionOCRFromBuffer(
      buf,
      type || "image/jpeg",
      "Transcreva fielmente a redação manuscrita. Coloque numeração de linha no INÍCIO de cada linha, no formato (1) (2) (3) ... Não resuma; transcreva tudo."
    );
    return t || "";
  } catch { return ""; }
}

/* ---------------- snapshot curto (só se .txt) ---------------- */
async function readEssaySnapshotIfTxt(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type.includes("text") || name.endsWith(".txt")) {
    try { return (await file.text()).slice(0, 12000); } catch { return ""; }
  }
  return "";
}

/* ---------------- verificador de tema (opcional) ---------------- */
async function checkThemeStrict(propostaText: string, essayText: string):
  Promise<{decision:"meets"|"partial"|"misses", reason: string}> {
  if (!process.env.OPENAI_API_KEY) return { decision: "partial", reason: "sem API" };
  if (!propostaText || !essayText)  return { decision: "partial", reason: "dados insuficientes" };

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      { role: "system", content: "Você é um verificador MUITO rigoroso de aderência ao tema (vestibulares brasileiros). Responda somente com JSON." },
      { role: "user", content:
        `PROPOSTA (tema + motivadores):\n${propostaText}\n\n` +
        `REDAÇÃO (texto integral ou snapshot):\n${essayText}\n\n` +
        `Responda JSON com { "decision": "meets|partial|misses", "reason": "..." }`
      }
    ]
  });

  try {
    const txt = String(res?.choices?.[0]?.message?.content || "").trim();
    const obj = JSON.parse(txt || "{}");
    const d = (obj?.decision || "").toLowerCase();
    if (d === "misses")  return { decision: "misses", reason: limitReason(obj?.reason || "fuga de tema") };
    if (d === "partial") return { decision: "partial", reason: limitReason(obj?.reason || "") };
    return { decision: "meets", reason: "" };
  } catch {
    return { decision: "partial", reason: "falha de parsing" };
  }
}

/* ---------------- HTML bonito ---------------- */
function buildPrettyHTML(
  report: any,
  score?: number,
  bannerHTML?: string,
  feedbackOverride?: string,
  addressingOverride?: "meets"|"partial"|"misses"|null,
  essayTranscription?: string
) {
  const institution = report?.institution ?? "—";
  const addressing = addressingOverride ?? report?.addressing_of_theme;
  const criteria = Array.isArray(report?.criteria) ? report.criteria : [];
  const finalScore = typeof score === "number"
    ? score
    : (typeof report?.final_score_0_100 === "number" ? report.final_score_0_100 : null);
  const feedback = feedbackOverride ?? report?.overall_feedback;

  const rows = criteria.map((c: any) => {
    const evidences = Array.isArray(c.evidence) ? c.evidence : [];
    const level = (typeof c.level_score_native === "number")
      ? c.level_score_native
      : (typeof c.level_chosen === "number" ? c.level_chosen : "—");
    const weight = (typeof c.weight === "number")
      ? (c.weight > 1 ? `${Math.round(c.weight)}%` : `${Math.round(c.weight * 100)}%`)
      : "—";
    // ✔️ Alinha com requisito: Nível = "X de 5"; Peso = apenas percentual
    return `<tr>
      <td><strong>${escapeHtml(String(c.id || ""))}</strong> — ${escapeHtml(String(c.name || ""))}</td>
      <td>${escapeHtml(String(level))} de 5</td>
      <td>${escapeHtml(weight)}</td>
      <td>${escapeHtml(String(c.justification || "—"))}</td>
      <td>${evidences.length ? `<ul>${evidences.map((ev: string) => `<li>${escapeHtml(ev)}</li>`).join("")}</ul>` : "—"}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Relatório</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin: 0; background: #f6f7f9; }
  .wrap { max-width: 960px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  h1 { font-size: 24px; margin: 8px 0 12px; }
  h2 { font-size: 18px; margin: 16px 0 8px; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 6px; font-size: 14px; vertical-align: top; }
  thead th { border-bottom: 1px solid #e5e7eb; color: #374151; font-size: 13px; }
  tbody td { border-bottom: 1px solid #f3f4f6; }
  .muted { color: #6b7280; }
  .warn { border-color:#fecaca; background:#fff1f2 }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  details { margin-top: 8px; }
  summary { cursor: pointer; user-select: none; }
</style>
</head><body>
<div class="wrap">
  <div class="card">
    <h1>Relatório — ${escapeHtml(String(institution))}</h1>
    ${finalScore !== null ? `<div class="pill">Nota final: ${finalScore}</div>` : ``}
    ${addressing ? `<div style="margin-top:6px" class="muted">Aderência ao tema (verificador): ${escapeHtml(String(addressing))}</div>` : ``}
  </div>
  ${bannerHTML || ``}
  <div class="card">
    <h2>Critérios</h2>
    <table>
      <thead><tr><th>Critério</th><th>Nível</th><th>Peso</th><th>Justificativa</th><th>Evidências</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">Sem critérios informados.</td></tr>`}</tbody>
    </table>
  </div>
  ${feedback ? `<div class="card"><h2>Feedback geral</h2><p>${escapeHtml(String(feedback))}</p></div>` : ``}
  ${Array.isArray((report as any)?.actionable_edits) && (report as any).actionable_edits.length
    ? `<div class="card"><h2>Próximas ações</h2><ul>${(report as any).actionable_edits.map((e: string)=>`<li>${escapeHtml(e)}</li>`).join("")}</ul></div>`
    : ``}
  ${essayTranscription
    ? `<div class="card">
         <h2>Transcrição da redação (OCR para conferência)</h2>
         <details open><summary>Mostrar/Ocultar transcrição</summary>
           <pre>${escapeHtml(essayTranscription)}</pre>
         </details>
       </div>`
    : ``}
</div>
</body></html>`;
}

/* --- Faxina mínima para ruídos típicos de OCR (sem reescrever o aluno) */
function minimalOCREdits(s: string) {
  return String(s)
    .replace(/\s+([,.;:!?])/g, "$1")   // remove espaço antes de pontuação
    .replace(/\(\s+\)/g, "")           // remove parênteses vazios
    .replace(/\s{2,}/g, " ");          // colapsa espaços múltiplos
}

/* ---------------- handler ---------------- */
export async function POST(req: Request) {
  try {
    const incoming = await req.formData();
    const rubric = String(incoming.get("rubric") || "");

    // Observa se o cliente já mandou um override explícito
    const incomingOverride = String(incoming.get("essay_text_override") || "").trim();

    const essayFile = incoming.get("file") as File | null;
    const propostaTextField = String(incoming.get("proposta") || "");
    const propostaFile = incoming.get("proposta_file") as File | null;

    // 1) PROPOSTA
    let propostaText = "";
    let source_proposta: "img_ocr" | "text" | "fallback" = "fallback";
    if (propostaFile) {
      const r = await readProposalFromFile(propostaFile);
      if (r.text) { propostaText = r.text; source_proposta = r.source; }
    }
    if (!propostaText && propostaTextField && propostaTextField.trim()) {
      propostaText = propostaTextField.trim();
      source_proposta = "text";
    }
    if (!propostaText) {
      propostaText = "[Proposta enviada em arquivo; leitura indisponível. Avaliar aderência geral ao tema.]";
      source_proposta = "fallback";
    }

    // 2) REDAÇÃO — transcrição para exibir no relatório
    // Prioridade de fonte da transcrição exibida: override explícito > OCR de imagem > vazio
    let essayTranscription = "";
    if (incomingOverride) {
      essayTranscription = incomingOverride;
    } else if (essayFile) {
      essayTranscription = await readEssayTranscriptionForDisplay(essayFile);
    }

    // 3) snapshot txt (gate)
    let essaySnapshot = "";
    if (essayFile) essaySnapshot = await readEssaySnapshotIfTxt(essayFile);

    // 4) Encaminhar para o avaliador "lite"
    const forward = new FormData();
    if (essayFile) forward.append("file", essayFile, essayFile.name);
    forward.append("rubric", rubric);
    forward.append("proposta", propostaText);

    // ▶ PRIORIDADE de envio ao avaliador:
    //    - Se o cliente já mandou essay_text_override, preserve-o;
    //    - Senão, se geramos OCR de imagem (essayTranscription), use como override;
    //    - Caso contrário, deixe o arquivo seguir e o /api/essay-grade-lite decide.
    if (incomingOverride) {
      forward.append("essay_text_override", incomingOverride);
    } else if (essayTranscription) {
      forward.append("essay_text_override", essayTranscription);
    }

    const host = req.headers.get("host") || "127.0.0.1:3001";
    const base = host.startsWith("http") ? host : `http://${host}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    let resp: Response;
    try {
      resp = await fetch(`${base}/api/essay-grade-lite`, { method: "POST", body: forward, signal: ctrl.signal });
    } finally { clearTimeout(timer); }

    const raw = await resp.text();
    if (!resp.ok) {
      const maybe = tryParseJSONLoose(raw);
      const msg = (maybe && (maybe.error || maybe.message))
        ? String(maybe.error || maybe.message)
        : `Erro ao avaliar (HTTP ${resp.status}).`;
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const data = tryParseJSONLoose(raw) ?? { report_html: raw };
    let reportObj: any = null;
    if (looksLikeReport(data)) reportObj = data;
    else {
      const cands = [data?.report_html, data?.report_json, data?.report];
      for (const c of cands) {
        if (!c) continue;
        if (typeof c === "object" && looksLikeReport(c)) { reportObj = c; break; }
        if (typeof c === "string") { const p = tryParseJSONLoose(c); if (p && looksLikeReport(p)) { reportObj = p; break; } }
      }
    }

    const baseScore = extractScore(data, reportObj);
    let adjustedScore = typeof baseScore === "number" ? baseScore : undefined;

    // 5) (opcional) gate de tema quando tivermos snapshot
    let banner = "";
    let feedbackOverride: string | undefined;
    let addressingOverride: "meets"|"partial"|"misses"|null = null;

    if (propostaText && essaySnapshot) {
      try {
        const gate = await checkThemeStrict(clip(propostaText, 8000), clip(essaySnapshot, 8000));
        if (gate.decision === "misses") {
          const capped = Math.min(Number(adjustedScore ?? 100), 20);
          adjustedScore = capped;
          addressingOverride = "misses";
          banner = `<div class="card warn"><strong>Fuga de tema:</strong> nota limitada a <strong>${capped}</strong>. ${gate.reason ? escapeHtml("Motivo: " + limitReason(gate.reason)) : ""}</div>`;
          feedbackOverride = `FUGA DE TEMA: a redação não atende ao tema. A nota foi limitada a ${capped}. Reescreva seguindo a proposta.`;
        } else if (gate.decision === "partial") {
          const capped = Math.min(Number(adjustedScore ?? 100), 60);
          adjustedScore = capped;
          addressingOverride = "partial";
          banner = `<div class="card warn"><strong>Aderência parcial ao tema:</strong> nota limitada a <strong>${capped}</strong>. ${gate.reason ? escapeHtml("Motivo: " + limitReason(gate.reason)) : ""}</div>`;
          feedbackOverride = `ADERÊNCIA PARCIAL AO TEMA: a nota foi limitada a ${capped}. Reforce a conexão com a proposta.`;
        } else {
          addressingOverride = "meets";
        }
      } catch {}
    }

    // 6) HTML final (com transcrição exibida)
    let report_html = "";
    if (reportObj) report_html = buildPrettyHTML(reportObj, adjustedScore, banner, feedbackOverride, addressingOverride, essayTranscription);
    else if (typeof (data as any)?.report_html === "string" && (data as any).report_html.trim().startsWith("<"))
      report_html = (data as any).report_html;
    else
      report_html = `<!doctype html><html><body><pre>${escapeHtml(raw)}</pre></body></html>`;

    return NextResponse.json({
      score: adjustedScore,
      report_html,
      source_proposta,
      proposta_preview: clip(propostaText, 200),
      essay_transcription_len: essayTranscription?.length || 0,
    });
  } catch (err: any) {
    const msg = (err && err.name === "AbortError")
      ? "Tempo limite excedido ao avaliar. Tente com arquivo menor ou apenas 1 página."
      : ((err && err.message) ? String(err.message) : "Unexpected error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}