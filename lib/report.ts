export function renderReportHTML(data: any) {
  const crit = (data.criteria||[]).map((c: any) => `
    <section>
      <h3>${c.id} — ${c.name} (peso ${(c.weight*100).toFixed(0)}%)</h3>
      <p><b>Nível:</b> ${c.level_chosen} (${c.level_score_native})</p>
      <p><b>Justificativa:</b> ${escapeHTML(c.justification)}</p>
      <p><b>Evidências:</b> ${(c.evidence||[]).map((e:string)=>`“${escapeHTML(e)}”`).join("; ")}</p>
    </section>
  `).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <title>${data.institution} — Avaliação de Redação</title>
  <style>
  body{font-family:Arial,Helvetica,sans-serif;margin:28px;color:#111;line-height:1.5}
  h1{font-size:22px;margin:0 0 6px}
  h2{font-size:18px;margin:16px 0 6px}
  h3{font-size:16px;margin:14px 0 6px}
  .badge{padding:4px 10px;border:1px solid #bbb;border-radius:999px;display:inline-block}
  ol{margin:0 0 0 20px}
  footer{margin-top:28px;color:#666;font-size:12px}
  </style></head><body>
  <h1>${data.institution} — Avaliação de Redação</h1>
  <div class="badge">Nota (0–100): <b>${data.final_score_0_100}</b></div>
  <h2>Proposta (resumo)</h2><p>${escapeHTML(data.proposta_summary||"")}</p>
  <h2>Endereçamento do tema</h2><p>${escapeHTML(data.addressing_of_theme||"")}</p>
  <h2>Critérios</h2>${crit}
  <h2>Feedback geral</h2><p>${escapeHTML(data.overall_feedback||"")}</p>
  <h2>Próximos passos</h2><ol>${(data.actionable_edits||[]).map((a:string)=>`<li>${escapeHTML(a)}</li>`).join("")}</ol>
  <footer>${escapeHTML(data.ethics_note||"")}</footer>
  </body></html>`;
}
function escapeHTML(s: string){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]!));
}
