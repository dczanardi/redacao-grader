// app/tools/redacao/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type RubricListResp = { items?: { id: string; file: string }[]; error?: string };
type GradeResp = { ok?: boolean; report_html?: string; total?: number; error?: string };

export default function Redacao() {
  const [rubrics, setRubrics] = useState<string[]>([]);
  const [rubric, setRubric] = useState("");
  const [student, setStudent] = useState("");
  const [proposalText, setProposalText] = useState("");
  const [proposalFile, setProposalFile] = useState<File|null>(null);
  const [essay, setEssay] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState("");
  const [score, setScore] = useState<number|undefined>(undefined);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/rubrics");
        const data: RubricListResp = await res.json();
        const list = (data.items || []).map(x => x.id);
        setRubrics(list);
        if (!rubric && list.length) setRubric(list.includes("FUVEST") ? "FUVEST" : list[0]);
      } catch {
        setRubrics(["FUVEST","ENEM","UNESP","CSA"]);
        if (!rubric) setRubric("FUVEST");
      }
    })();
  }, []);

  const canSubmit = useMemo(()=> !!essay.trim() && !!rubric, [essay, rubric]);

  async function avaliar(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) { alert("Selecione a rubrica e cole o texto da redação."); return; }
    setLoading(true); setReport(""); setScore(undefined);

    const fd = new FormData();
    fd.append("rubric", rubric);
    fd.append("student_name", student);
    fd.append("proposal_text", proposalText);
    if (proposalFile) fd.append("proposal_file", proposalFile);
    fd.append("essay_text_override", essay);

    try {
      const res = await fetch("/api/grade2", { method:"POST", body: fd });
      const txt = await res.text();
      let data: GradeResp | null = null; try { data = JSON.parse(txt); } catch {}
      if (!res.ok || !data) throw new Error((data?.error)||txt);
      setReport(String(data.report_html||""));
      setScore(data.total);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    } catch (err:any) {
      alert(`Falha na avaliação: ${err?.message||String(err)}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function baixarHTML() {
    if (!report) return;
    const blob = new Blob([report], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (student||"aluno").replace(/\s+/g,"_");
    a.download = `relatorio-${rubric}-${safeName}.html`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  async function baixarPDF() {
    if (!report) return;
    setPdfBusy(true);
    try {
      const safeName = (student||"aluno").replace(/\s+/g,"_");
      const res = await fetch("/api/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: report,
          fileName: `relatorio-${rubric}-${safeName}.pdf`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err?.error || `Falha HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-${rubric}-${safeName}.pdf`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch (e:any) {
      alert(`Falha ao gerar PDF: ${e?.message||e}`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <h1>Correção de Redação</h1>

      {/* Texto atualizado (duas linhas) */}
      <p style={{ color:"#555", marginBottom: 0 }}>
        <b>COLE A PROPOSTA DA REDAÇÃO</b> NO ESPAÇO A SEGUIR OU FAÇA O UPLOAD DA PROPOSTA (JPEG, PNG ou PDF).
      </p>
      <p style={{ color:"#555", marginTop: 4 }}>
        <b>COLE A REDAÇÃO</b> NO CAMPO CORRESPONDENTE.
      </p>

      <form onSubmit={avaliar} style={{ display:"grid", gap:12, marginTop:12 }}>
        <label>Vestibular / Rubrica
          <select value={rubric} onChange={e=>setRubric(e.target.value)} style={{ display:"block", marginTop:4 }}>
            {rubrics.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <label>Nome do aluno (opcional)
          <input value={student} onChange={e=>setStudent(e.target.value)} placeholder="Ex.: Maria Souza" style={{ display:"block", marginTop:4, width:"100%" }} />
        </label>

        <label>Texto da proposta (opcional)
          <textarea value={proposalText} onChange={e=>setProposalText(e.target.value)} rows={4} style={{ width:"100%", marginTop:4, fontFamily:"monospace" }} placeholder="Cole aqui (se preferir, envie o arquivo abaixo)"></textarea>
        </label>

        <label>Proposta em arquivo (imagem ou PDF) — opcional
          <input type="file" accept="image/*,application/pdf" onChange={e=>setProposalFile(e.target.files?.[0]||null)} style={{ display:"block", marginTop:4 }} />
        </label>

        <label>Transcrição da redação (COLE aqui — texto final corrigido)
          <textarea value={essay} onChange={e=>setEssay(e.target.value)} rows={12} style={{ width:"100%", marginTop:4, fontFamily:"monospace" }} placeholder="Cole o texto da redação (já corrigido)."></textarea>
        </label>

        <button disabled={loading || !canSubmit}>
          {loading ? "Gerando avaliação..." : "Avaliar"}
        </button>
      </form>

      {report && (
        <div style={{ marginTop:16 }}>
          <div style={{ marginBottom:8, display:"flex", gap:8, alignItems:"center" }}>
            <b>Nota (0–100):</b> {score?.toFixed(0) ?? "—"}
            <button onClick={baixarHTML}>Baixar HTML</button>
            <button onClick={baixarPDF} disabled={pdfBusy}>{pdfBusy ? "Gerando PDF..." : "Baixar PDF"}</button>
          </div>
          <iframe title="Relatório" style={{ width:"100%", height:560, border:"1px solid #ddd" }} srcDoc={report} />
        </div>
      )}
    </div>
  );
}