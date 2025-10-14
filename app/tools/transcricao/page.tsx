// app/tools/transcricao/page.tsx
"use client";

import { useState } from "react";

type Resp = { ocr_clean?: string; mode?: string; error?: string };

export default function Transcricao() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState("");

  async function transcreverCorrigido(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { alert("Anexe uma IMAGEM (JPG/PNG)."); return; }
    if (!file.type?.startsWith("image/")) { alert("Aceita somente IMAGEM (JPG/PNG)."); return; }

    setLoading(true); setText(""); setMode("");
    const fd = new FormData(); fd.append("file", file);

    try {
      const res = await fetch("/api/ocr-chat", { method: "POST", body: fd });
      const txt = await res.text();
      let data: Resp | null = null;
      try { data = JSON.parse(txt); } catch {}
      if (!res.ok || !data) throw new Error((data?.error) || txt);

      setText(String(data.ocr_clean || ""));
      setMode(String(data.mode || "chat-like:polish"));
      alert("Transcrição concluída (corrigida). Revise o texto abaixo.");
    } catch (err:any) {
      alert(`Falha na transcrição: ${err?.message || String(err)}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <h1>Transcrição (GPT-5 corrigida)</h1>
      <p style={{ color:"#666" }}>
        Este modo usa o GPT-5 para <b>corrigir e unificar</b> o texto (desfaz hifenização, corrige ortografia e fluência).
        A saída abaixo já é a versão final para colar na correção.
      </p>

      <form onSubmit={transcreverCorrigido} style={{ display:"grid", gap:12, marginTop:12 }}>
        <label>Imagem da redação (JPG/PNG)
          <input
            type="file"
            accept="image/*"
            onChange={(e)=>setFile(e.target.files?.[0]||null)}
            style={{ display:"block", marginTop:4 }}
          />
        </label>

        <button disabled={loading}>
          {loading ? "Processando…" : "Transcrever (GPT-5 corrigido)"}
        </button>
      </form>

      {text && (
        <div style={{ marginTop:16 }}>
          <div style={{ color:"#555", marginBottom:8 }}>Modo: <b>{mode}</b></div>
          <h3>Texto final (corrigido)</h3>
          <textarea
            value={text}
            onChange={(e)=>setText(e.target.value)}
            rows={18}
            style={{ width:"100%", fontFamily:"monospace", padding:8 }}
          />
          <div style={{ marginTop:8, display:"flex", gap:8, flexWrap:"wrap" }}>
            <button type="button" onClick={()=>navigator.clipboard.writeText(text)}>Copiar texto</button>
            <a href="/tools/redacao" style={{ padding:"6px 10px", border:"1px solid #ccc", borderRadius:6, textDecoration:"none" }}>
              Abrir ferramenta de correção
            </a>
          </div>
        </div>
      )}
    </div>
  );
}