import { NextRequest, NextResponse } from "next/server";
import { getReportById } from "@/lib/store";
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const rep = getReportById(id);
  if (!rep) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(rep.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
