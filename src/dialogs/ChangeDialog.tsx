import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../api/commands";
import { DiffBlocks } from "../components/DiffBlocks";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { Btn, gap } from "../components/ui";
import { toast, useStore } from "../state/store";

/** «Cambio propuesto»: vista previa obligatoria antes de escribir cualquier fichero. */
export function ChangeDialog() {
  const change = useStore((s) => s.change);
  const askChange = useStore((s) => s.askChange);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  if (!change) return null;

  const close = () => {
    if (busy) return;
    change.onCancel?.();
    askChange(null);
  };
  const apply = async () => {
    if (change.readOnly || !change.onApply) {
      askChange(null);
      return;
    }
    setBusy(true);
    try {
      await change.onApply();
      askChange(null);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const blocked = (change.errors?.length ?? 0) > 0;

  return (
    <Modal
      icon="file-code"
      title={change.title}
      size="md"
      onClose={close}
      labelId="diff-title"
      foot={
        <>
          <div className="od-fill meta">{change.note}</div>
          {!change.readOnly && (
            <button type="button" className="btn btn-default" data-close-overlay onClick={close}>
              {t("common.cancel")}
            </button>
          )}
          <Btn
            variant={change.readOnly ? "default" : change.danger ? "danger" : "primary"}
            onClick={apply}
            disabled={blocked}
            busyLabel={t("common.applying")}
          >
            {change.readOnly
              ? t("common.close")
              : (change.applyLabel ?? (change.danger ? t("common.deactivate") : t("common.apply")))}
          </Btn>
        </>
      }
    >
      <div className="modal-body od-stack" style={gap(14)}>
        {blocked && (
          <div className="banner banner-danger" style={{ margin: 0 }} role="alert">
            <Icon name="alert" />
            <div className="od-fill od-stack" style={gap(4)}>
              <strong>{t("common.change.blocked")}</strong>
              <ul className="err-list" role="list">
                {change.errors?.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {change.warn && (
          <div className="banner banner-warn" style={{ margin: 0 }}>
            <Icon name="alert" />
            <div className="od-fill">
              <strong>{t("common.change.beforeContinue")}</strong>
              <span className="banner-text" style={{ display: "block" }}>
                {change.warn}
              </span>
            </div>
          </div>
        )}
        {change.extra}
        <DiffBlocks blocks={change.blocks} />
      </div>
    </Modal>
  );
}
