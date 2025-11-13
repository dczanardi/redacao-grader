// app/page.tsx
import Link from "next/link";
import InstructionsPanel from "../components/InstructionsPanel";

export default function Home() {
  return (
    <main style={{ maxWidth: 880, margin: "40px auto", padding: 16 }}>
      <InstructionsPanel transcriberUrl=" https://chatgpt.com/g/g-68cdaa126d30819183fba7761fcd2aa8-transcricao-de-redacao " />
      <h1 style={{ marginBottom: 8 }}>Correção de Redação</h1>
      <p style={{ color: "#444", marginTop: 0 }}>
        Escolha uma das opções abaixo para começar:
      </p>

      <nav style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <Link
          href="/tools/redacao"
          style={{
            display: "block",
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            textDecoration: "none",
          }}
        >
          ➡️ <b>Abrir a ferramenta de correção</b>
          <div style={{ color: "#666", fontSize: 14 }}>
            Envie a proposta (texto ou imagem) e a redação (imagem/DOCX/TXT). Faça a transcrição se precisar
            e gere o relatório com nota final.
          </div>
        </Link>

        <Link
          href="/tools/transcricao"
          style={{
            display: "block",
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            textDecoration: "none",
          }}
        >
          📝 <b>Transcrever redação (OCR)</b>
          <div style={{ color: "#666", fontSize: 14 }}>
            Converta imagem manuscrita em texto com numeração de linhas e use esse texto na correção.
          </div>
        </Link>
      </nav>

      <section style={{ marginTop: 24, padding: "12px 14px", border: "1px solid #eee", borderRadius: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Dicas rápidas</h2>
        <ul style={{ marginTop: 8, color: "#555" }}>
          <li>Se você digitar/colar o texto no campo de transcrição, ele terá <b>prioridade</b> na avaliação.</li>
          <li>No relatório, a coluna <b>Nível</b> mostra “X de 5” e <b>Peso</b> mostra só o percentual.</li>
          <li>A FUVEST usa pesos: <b>C1=0.40, C2=0.30, C3=0.15, C4=0.15</b>.</li>
        </ul>
      </section>
    </main>
  );
}