// @ts-nocheck
// app/api/ocr-chat/route.ts
// OCR "estilo chat": sempre CORRIGIDO (polished). Agora com captura garantida do TÍTULO manuscrito.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

const S = (v: any) => (v == null ? "" : String(v));
const isImg = (f?: File | null) => !!f && (f.type || "").toLowerCase().startsWith("image/");

/** Heurística simples para decidir se o título já está no texto polido */
function needsPrependTitle(title: string, body: string) {
  const t = title.trim();
  if (!t) return false;
  const head = body.slice(0, 200).toLowerCase();
  const tt = t.toLowerCase();
  // se já aparece no começo, não precisamos repetir
  if (head.includes(tt)) return false;
  // evita títulos muito longos (às vezes vira uma frase inteira)
  if (t.length > 120) return false;
  // evita “título” com muitos sinais estranhos
  if ((t.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length < Math.max(3, t.length * 0.4)) return false;
  return true;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!isImg(file)) {
      return NextResponse.json({ error: "Envie uma IMAGEM (JPG/PNG)." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const mime = (file.type || "image/jpeg").toLowerCase();
    const base64 = Buffer.from(bytes).toString("base64");

    // 1) Texto polido (corrigido) — como você quer, sem versão bruta
    const polishedRes = await openai.chat.completions.create({
      model: process.env.OCR_MODEL_PRIMARY || "gpt-5",
      messages: [
        {
          role: "system",
          content:
            "Você é um OCR-editor em pt-BR. Leia o manuscrito na imagem e produza um texto CORRIGIDO e COESO em português padrão. " +
            "Una linhas quebradas, desfaça hifenizações de fim de linha, corrija ortografia e pequenos deslizes sintáticos, " +
            "preservando a ideia do autor. Devolva SOMENTE o texto corrido (sem enumeração, sem comentários).",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Produza o texto final, pronto para leitura, em parágrafos naturais." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } } as any,
          ] as any,
        },
      ],
    });

    let polished = S(polishedRes?.choices?.[0]?.message?.content || "").trim();
    if (!polished) throw new Error("Sem retorno do modelo (polido).");

    // 2) Título manuscrito (primeira linha) — chamada curtinha
    //    Obs.: pedimos explicitamente para retornar APENAS o título (ou vazio).
    let title = "";
    try {
      const titleRes = await openai.chat.completions.create({
        model: process.env.OCR_MODEL_PRIMARY || "gpt-5",
        messages: [
          {
            role: "system",
            content:
              "Você é um OCR em pt-BR. Extraia APENAS o título manuscrito (a PRIMEIRA linha escrita pelo aluno dentro da área de redação). " +
              "Se não houver título, devolva vazio. Não devolva comentários.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Retorne somente o título (uma linha) ou vazio." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } } as any,
            ] as any,
          },
        ],
      });
      title = S(titleRes?.choices?.[0]?.message?.content || "").trim();
      // algumas vezes o modelo retorna aspas ou marcações — limpamos leve
      title = title.replace(/^["“”'\s]+|["“”'\s]+$/g, "");
    } catch {
      // se falhar, seguimos só com o polido
      title = "";
    }

    // 3) Se o título não estiver no começo do texto, prepend
    if (needsPrependTitle(title, polished)) {
      polished = `${title}\n\n${polished}`;
    }

    return NextResponse.json({
      ocr_clean: polished,     // apenas o texto final que você usa
      mode: "chat-like:polish+title",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Falha no OCR (chat-like)" },
      { status: 500 }
    );
  }
}