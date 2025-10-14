// @ts-nocheck
// app/api/transcribe/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

/* ========= helpers ========= */
const S = (v: any) => (v == null ? "" : String(v));
const stripBOM = (s: string) => S(s).replace(/^\uFEFF/, "");
const isImg = (f?: File | null) =>
  !!f && ((f.type || "").toLowerCase().startsWith("image/"));

/* ========= prompts ========= */
const SYSTEM_OCR =
  "Você é um OCR em pt-BR. Transcreva fielmente APENAS o que está escrito. " +
  "Não corrija, não traduza, não reescreva. Se não entender uma palavra, use [?]. " +
  "Devolva SOMENTE texto (sem comentários).";

const PROMPT_STABLE =
  "Transcreva o manuscrito mantendo **as quebras de linha exatas**. " +
  "Não junte em parágrafos. Não enumere (eu vou numerar depois). " +
  "Ignore cabeçalhos como 'VERSÃO FINAL' e rodapés/códigos da folha. " +
  "Se algo estiver ilegível, use [?] no lugar da palavra.";

const PROMPT_AGGRESSIVE_LINE =
  "Transcreva APENAS o que está escrito na LINHA manuscrita desta imagem (uma única linha). " +
  "Não use texto de outras linhas. Se a linha estiver ilegível, devolva vazio.";

/* ========= core calls ========= */
async function callVision(base64: string, mime: string, prompt: string, model: string) {
  const r = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_OCR },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } } as any,
        ] as any,
      },
    ],
  });
  return S(r?.choices?.[0]?.message?.content).trim();
}

/* ========= quality + cleaning ========= */
function qualityScore(t: string) {
  const s = stripBOM(S(t)).replace(/\r\n?/g, "\n");
  const len = Math.max(1, s.length);
  const letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const illeg = (s.match(/\[\?\]/g) || []).length;
  const dup = (s.match(/\b(\w{1,4})\s+\1\b/gi) || []).length;
  const badTok = (s.match(/\b(desculpe|vazio|a linha.*branc|não consigo)/gi) || []).length;
  return (letters / len) * 120 - illeg * 2 - dup * 1.5 - badTok * 10;
}

function stripModelApologiesLine(line: string) {
  const L = (line || "").trim();
  if (!L) return "";
  if (/^desculpe|^vaz[ií]o|^sem conte[uú]do|^a linha .*?branc|^não consigo/i.test(L)) return "";
  return line;
}

function cleanAndNumber(input: string) {
  const src = stripBOM(S(input)).replace(/\r\n?/g, "\n");

  // 1) remove cabeçalho/rodapé/códigos e linhas que são só nº impresso
  const keep = src.split("\n").filter((l) => {
    const L = l.trim();
    if (!L) return true;
    if (/^VERS[ÃA]O\s+FINAL$/i.test(L)) return false;
    if (/^\(?\d{1,3}\)?\s*$/.test(L)) return false;
    if (/\b[A-Z0-9]{4,}-[A-Z0-9-]{4,}\b/.test(L)) return false;
    return true;
  });

  // 2) cola hifenização de quebra e normaliza espaços/pontuação
  let t = keep.join("\n");
  t = t.replace(/-\s*\n\s*/g, "");
  t = t.replace(/\s+([,.;:!?])/g, "$1")
       .replace(/“|”/g, '"').replace(/‘|’/g, "'")
       .replace(/\s{2,}/g, " ");

  // 3) remove numeração antiga e “desculpas”, poda linhas vazias
  const lines = t
    .split("\n")
    .map((l) => l.replace(/^\s*\(\d{1,3}\)\s*/, ""))
    .map(stripModelApologiesLine)
    .map((l) => l.trim())
    .filter(Boolean);

  // 4) (opcional) duplicações gritantes
  const lines2 = lines.map((l) =>
    l
      .replace(/\bpor\s+um\s+uma\b/gi, "por uma")
      .replace(/\be\s+e\b/gi, "e")
      .replace(/\bde\s+de\b/gi, "de")
      .replace(/\bque\s+que\b/gi, "que")
  );

  // 5) renumera
  return lines2.map((l, i) => `(${i + 1}) ${l}`).join("\n");
}

/* ========= SHARP (agressivo – opcional) ========= */
type Sharp = typeof import("sharp");
async function trySharp(): Promise<Sharp | null> {
  try { const m = await import("sharp"); return m.default ?? (m as any); } catch { return null; }
}

async function sliceWithSharp(bytes: ArrayBuffer, linesTarget = 24): Promise<Buffer[] | null> {
  const sharp = await trySharp();
  if (!sharp) return null;

  const base = sharp(Buffer.from(bytes));
  const meta = await base.metadata();
  const W = meta.width ?? 1700;
  const H = meta.height ?? 2200;

  // recorte útil (tira coluna de números e cabeçalho)
  const cropX = Math.max(0, Math.round(W * 0.08));
  const cropY = Math.max(0, Math.round(H * 0.06));
  const cropW = Math.max(24, Math.min(W - cropX, Math.round(W * 0.88)));
  const cropH = Math.max(24, Math.min(H - cropY, Math.round(H * 0.86)));

  const cropped = await base.extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .grayscale().normalize().sharpen().toBuffer();

  const info = await (await sharp(cropped)).metadata();
  const CW = info.width ?? cropW, CH = info.height ?? cropH;

  const lineH = Math.max(18, Math.floor(CH / linesTarget));
  const pad   = Math.max(6, Math.floor(lineH * 0.25));
  const out: Buffer[] = [];

  for (let i = 0; i < linesTarget; i++) {
    let top = i * lineH - pad; if (top < 0) top = 0;
    let h = lineH + 2 * pad; if (top + h > CH) h = CH - top;
    if (h <= 0 || top >= CH) continue;
    const buf = await sharp(cropped).extract({ left: 0, top: Math.round(top), width: CW, height: Math.round(h) })
      .toFormat("png").toBuffer();
    out.push(buf);
  }
  return out.length ? out : null;
}

/* ========= strategies ========= */

// 1) ESTÁVEL (página inteira, mantém quebras)
async function ocrStable(bytes: ArrayBuffer, mime: string) {
  const base64 = Buffer.from(bytes).toString("base64");
  const models = [process.env.OCR_MODEL_PRIMARY || "gpt-4o", "gpt-4o-mini", "gpt-4.1-mini"];

  const tries: { raw: string; clean: string; q: number }[] = [];
  for (const m of models) {
    try {
      const raw = await callVision(base64, mime, PROMPT_STABLE, m);
      const clean = cleanAndNumber(raw);
      tries.push({ raw, clean, q: qualityScore(clean) });
    } catch {}
  }
  if (!tries.length) throw new Error("OCR estável indisponível.");
  tries.sort((a,b)=>b.q-a.q);
  return tries[0];
}

// 2) AGRESSIVO (faixas por linha) — apenas quando solicitado
async function ocrAggressive(bytes: ArrayBuffer, mime: string) {
  const parts = await sliceWithSharp(bytes, 24);
  if (!parts) throw new Error("Pré-processamento indisponível.");
  const MODELS = [process.env.OCR_MODEL_PRIMARY || "gpt-4o", "gpt-4o-mini"];
  const MAX_CONC = 6;

  const lines: string[] = new Array(parts.length).fill("");
  let cursor = 0;
  async function worker() {
    while (cursor < parts.length) {
      const k = cursor++;
      const b64 = parts[k].toString("base64");
      let best = "", bestQ = -1;
      for (const m of MODELS) {
        try {
          const raw = await callVision(b64, "image/png", PROMPT_AGGRESSIVE_LINE, m);
          const txt = stripModelApologiesLine(raw).replace(/\n+/g, " ").trim();
          const q = qualityScore(txt);
          if (q > bestQ) { bestQ = q; best = txt; }
        } catch {}
      }
      lines[k] = best;
    }
  }
  await Promise.all(Array.from({ length: MAX_CONC }, worker));
  const raw = lines.map((l,i)=> l ? `(${i+1}) ${l}` : "").filter(Boolean).join("\n");
  const clean = cleanAndNumber(raw);
  return { raw, clean, q: qualityScore(clean) };
}

/* ========= handler ========= */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const aggressiveFlag = S(form.get("aggressive") || "").toLowerCase() === "1";
    if (!isImg(file)) {
      return NextResponse.json({ error: "Envie uma IMAGEM (jpg/png)." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const mime = (file.type || "image/jpeg").toLowerCase();

    // Sempre tenta primeiro o ESTÁVEL (o bom que funcionou pra você)
    const stable = await ocrStable(bytes, mime);

    // Se você pediu agressivo, roda também e escolhe o melhor
    if (aggressiveFlag) {
      try {
        const ag = await ocrAggressive(bytes, mime);
        if (ag.q > stable.q + 5) {
          return NextResponse.json({ ocr_raw: ag.raw, ocr_clean: ag.clean, mode: "aggressive" });
        }
      } catch {}
    }

    // default: estável
    return NextResponse.json({ ocr_raw: stable.raw, ocr_clean: stable.clean, mode: "stable" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha no OCR" }, { status: 500 });
  }
}