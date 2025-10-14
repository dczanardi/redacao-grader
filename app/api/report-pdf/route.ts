// @ts-nocheck
// app/api/report-pdf/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const isVercel = !!process.env.VERCEL || process.env.FORCE_CHROMIUM === "1";

function guessLocalChromePath(): string | null {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH!;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH!;
  const os = process.platform;
  const candidates: string[] = [];
  if (os === "win32") {
    candidates.push(
      "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
      "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
      "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
      "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe"
    );
  } else if (os === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/opt/google/chrome/chrome"
    );
  }
  const fs = require("fs");
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

async function launchBrowser() {
  if (!isVercel) {
    const exe = guessLocalChromePath();
    if (!exe) throw new Error(
      "Não encontrei o Chrome/Edge local. Instale o Google Chrome (ou Edge) OU defina PUPPETEER_EXECUTABLE_PATH."
    );
    const puppeteerCore = (await import("puppeteer-core")).default;
    return puppeteerCore.launch({
      headless: true,
      executablePath: exe,
      args: ["--no-sandbox","--disable-dev-shm-usage","--font-render-hinting=medium"],
    });
  }
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteerCore = (await import("puppeteer-core")).default;
  const executablePath = await chromium.executablePath();
  return puppeteerCore.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: true,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, ping: "report-pdf" });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const html = String(body.html || "");
    const fileName = String(body.fileName || "relatorio.pdf");
    if (!html) return NextResponse.json({ error: "HTML do relatório ausente." }, { status: 400 });

    const browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">
       <style>
         html,body{margin:0}
         body{font-family:Arial,Helvetica,sans-serif}
         /* garante que <pre> não estoure a margem */
         pre{white-space:pre-wrap;word-break:break-word}
       </style>
       </head><body>${html}</body></html>`,
      { waitUntil: "networkidle0" }
    );

    // 🔓 ABRE todos os <details> antes de imprimir
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach(d => (d.open = true));
    });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
    });

    await page.close();
    await browser.close();

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[report-pdf] error:", e);
    return NextResponse.json({ error: e?.message || "Falha ao gerar PDF" }, { status: 500 });
  }
}