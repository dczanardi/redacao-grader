import React from "react";

type Props = {
  transcriberUrl: string; // cole aqui o link do seu GPT de transcrição (passado por prop)
};

export default function InstructionsPanel({ transcriberUrl }: Props) {
  return (
    <section style={{ margin: "16px 0" }}>
      <details
        id="instrucoes"
        style={{
          background: "#fff",
          border: "1px solid #e7e7ea",
          borderRadius: 10,
          padding: "10px 14px",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 600,
          }}
        >
          <span>📘 Instruções</span>
          <span style={{ color: "#666", fontWeight: 400 }}>
            (clique para abrir/fechar)
          </span>
        </summary>

        <div
          style={{
            marginTop: 10,
            color: "#222",
            font: "14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif",
          }}
        >
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <b>Escolha a grade de correção</b> (ex.: ENEM, FUVEST, CSA_MUN_PP
              etc.).
            </li>
            <li>
              <b>Proposta</b>: anexe uma imagem da proposta <i>ou</i> cole o
              texto no campo de proposta.
            </li>
            <li>
              <b>Três maneiras de inserir a redação</b>:
              <ul style={{ margin: "6px 0 10px 18px" }}>
                <li>Digite diretamente no campo da redação; ou</li>
                <li>Cole um texto que você já digitou; ou</li>
                <li>
                  Se estiver <b>manuscrita</b>, salve como imagem e use a{" "}
                  <a
                    href={transcriberUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      margin: "0 6px",
                      padding: "6px 10px",
                      border: "1px solid #e7e7ea",
                      borderRadius: 8,
                      textDecoration: "none",
                    }}
                  >
                    Transcrição de Redação
                  </a>
                  para extrair o texto (upload com “+”). Depois,{" "}
                  <b>copie e cole</b> o texto transcrito no campo da redação.
                </li>
              </ul>
            </li>
            <li>
              <b>Clique em “Avaliar”</b> e aguarde o relatório.
            </li>
            <li>
              <b>Baixe o relatório em HTML</b> (o botão de PDF será removido).
            </li>
          </ol>
        </div>
      </details>
    </section>
  );
}
