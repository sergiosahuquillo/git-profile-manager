import i18n from "i18next";
import type { ChangeBlock } from "../state/store";
import { gap } from "./ui";

/** Vista previa de cambios: comandos exactos o diff completo del fichero (renderDiffBlocks del prototipo). */
export function DiffBlocks({ blocks }: { blocks: ChangeBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "cmd") {
          return (
            <div className="od-field" style={gap(6)} key={i}>
              <span className="label-like">{b.label ?? "Comando"}</span>
              {b.lines.map((l, j) => (
                <div className="cmd" key={j}>
                  <span className="prompt">&gt;</span>
                  <span className="text">{l}</span>
                </div>
              ))}
            </div>
          );
        }
        if (b.type === "code") {
          return (
            <div className="od-field" style={gap(6)} key={i}>
              <span className="label-like">{b.label}</span>
              <pre className="code">{b.text}</pre>
            </div>
          );
        }
        return (
          <div className="od-field" style={gap(6)} key={i}>
            <span className="label-like">{b.label ?? i18n.t("common.diff.file")}</span>
            <div className="diff">
              <div className="diff-file">{b.file}</div>
              <div className="diff-body">
                {b.lines.map((l, j) => {
                  const sign = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
                  const word = i18n.t(`common.diff.${l.kind}`);
                  return (
                    <div
                      className={`diff-line${l.kind === "add" ? " is-add" : l.kind === "del" ? " is-del" : ""}`}
                      key={j}
                    >
                      <span className="sign" aria-hidden="true">
                        {sign}
                      </span>
                      <span className="text">
                        <span className="sr-only">{word}: </span>
                        {l.text || " "}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
