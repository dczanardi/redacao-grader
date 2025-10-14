// app/api/rubrics/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic"; // evita cache em dev

type Item = { id: string; file: string };

const RUBRICS_DIR = path.join(process.cwd(), "rubrics");
const INDEX_FILE = path.join(RUBRICS_DIR, "index.json");

async function readIndexJson(): Promise<{ items: Item[] }> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);

    let items: Item[] = Array.isArray(parsed?.items) ? parsed.items : [];
    // Normaliza e remove qualquer item “index”
    items = items
      .filter(Boolean)
      .map((it: any) => ({ id: String(it.id), file: String(it.file) }))
      .filter((it) => it.id.toLowerCase() !== "index" && it.file.toLowerCase() !== "index.json");

    return { items };
  } catch {
    // Fallback: monta por listagem de arquivos .json (exceto index.json)
    const files = await fs.readdir(RUBRICS_DIR);
    const jsons = files
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .filter((f) => f.toLowerCase() !== "index.json");

    const items = jsons.map((f) => {
      const id = f.replace(/\.json$/i, "");
      return { id, file: f };
    });

    return { items };
  }
}

export async function GET() {
  try {
    const data = await readIndexJson();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "rubrics load error" }, { status: 500 });
  }
}