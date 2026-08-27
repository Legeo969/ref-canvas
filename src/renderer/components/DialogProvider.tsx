import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { FolderOpen, X } from "lucide-react";
import { translate } from "../app/i18n";
import { SelectMenu } from "./SelectMenu";

export interface FormDialogField {
  name: string;
  label: string;
  type?: "text" | "number" | "directory" | "textarea" | "select";
  options?: Array<{ value: string; label: string }>;
  /** When set, the field renders as a password input (no plaintext echo). */
  inputType?: "password";
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  rows?: number;
}

export interface FormDialogConfig {
  title: string;
  description?: string;
  confirmLabel?: string;
  fields: FormDialogField[];
  onSubmit?: (values: Record<string, string>) => void | Promise<void>;
}

export interface ConfirmDialogConfig {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Red destructive styling for irreversible actions. */
  danger?: boolean;
}

type DialogContextValue = {
  requestForm(
    config: FormDialogConfig,
  ): Promise<Record<string, string> | null>;
  /** Confirmation dialog; resolves true when the user confirms. */
  requestConfirm(config: ConfirmDialogConfig): Promise<boolean>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error("DIALOG_PROVIDER_MISSING");
  return context;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<FormDialogConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmDialogConfig | null>(
    null,
  );
  const dialogRef = useRef<HTMLElement | null>(null);
  const resolverRef = useRef<
    ((result: Record<string, string> | null) => void) | null
  >(null);
  const confirmResolverRef = useRef<((result: boolean) => void) | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback((result: Record<string, string> | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setConfig(null);
    setValues({});
    setErrors({});
    setFormError("");
    setSubmitting(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
    setConfirmConfig(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const requestConfirm = useCallback(
    (nextConfig: ConfirmDialogConfig) =>
      new Promise<boolean>((resolve) => {
        if (confirmResolverRef.current) confirmResolverRef.current(false);
        if (resolverRef.current) resolverRef.current(null);
        triggerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setFormError("");
        setSubmitting(false);
        confirmResolverRef.current = resolve;
        setConfirmConfig(nextConfig);
      }),
    [],
  );

  const requestForm = useCallback(
    (nextConfig: FormDialogConfig) =>
      new Promise<Record<string, string> | null>((resolve) => {
        if (resolverRef.current) resolverRef.current(null);
        triggerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        resolverRef.current = resolve;
        setValues(
          Object.fromEntries(
            nextConfig.fields.map((field) => [
              field.name,
              field.initialValue ?? "",
            ]),
          ),
        );
        setErrors({});
        setFormError("");
        setConfig(nextConfig);
      }),
    [],
  );

  useEffect(() => {
    if (!config && !confirmConfig) return;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        if (confirmConfig) closeConfirm(false);
        else close(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [role="combobox"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close, closeConfirm, config, confirmConfig, submitting]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!config) return;
    const nextErrors: Record<string, string> = {};
    const normalized = { ...values };
    for (const field of config.fields) {
      const value = (values[field.name] ?? "").trim();
      normalized[field.name] = value;
      if (field.required && !value) {
        nextErrors[field.name] = translate("dialogs.required").replace("{label}", field.label);
      } else if (field.maxLength && value.length > field.maxLength) {
        nextErrors[field.name] = translate("dialogs.maxLength").replace("{max}", String(field.maxLength));
      } else if (field.type === "number" && value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
          nextErrors[field.name] = translate("dialogs.invalidNumber");
        } else if (field.min !== undefined && number < field.min) {
          nextErrors[field.name] = translate("dialogs.min").replace("{min}", String(field.min));
        } else if (field.max !== undefined && number > field.max) {
          nextErrors[field.name] = translate("dialogs.max").replace("{max}", String(field.max));
        }
      }
    }
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      await config.onSubmit?.(normalized);
      close(normalized);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : translate("app.operationFailed"),
      );
      setSubmitting(false);
    }
  };

  return (
    <DialogContext.Provider value={{ requestForm, requestConfirm }}>
      {children}
      {config && (
        <div
          className="modal-backdrop form-dialog-backdrop"
          onMouseDown={() => {
            if (!submitting) close(null);
          }}
        >
          <section
            ref={dialogRef}
            className="modal-panel form-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <div>
                  <h2 id="form-dialog-title">{config.title}</h2>
                  {config.description && <p>{config.description}</p>}
                </div>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={translate("dialogs.close")}
                onClick={() => close(null)}
                disabled={submitting}
              >
                <X size={17} />
              </button>
            </header>
            <form onSubmit={(event) => void submit(event)}>
              <div className="form-dialog-fields">
                {config.fields.map((field, index) => (
                  <label key={field.name} className="form-dialog-field">
                    <span>{field.label}</span>
                    <div className="form-dialog-input-row">
                      {field.type === "textarea" ? (
                        <textarea
                          data-autofocus={index === 0 ? "" : undefined}
                          rows={field.rows ?? 7}
                          value={values[field.name] ?? ""}
                          placeholder={field.placeholder}
                          maxLength={field.maxLength}
                          onKeyDown={(event) => {
                            if (
                              (event.ctrlKey || event.metaKey) &&
                              event.key === "Enter"
                            ) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                          onChange={(event) => {
                            setValues((current) => ({
                              ...current,
                              [field.name]: event.target.value,
                            }));
                            setErrors((current) => ({
                              ...current,
                              [field.name]: "",
                            }));
                          }}
                        />
                      ) : field.type === "select" ? (
                        <SelectMenu
                          autoFocus={index === 0}
                          value={values[field.name] ?? field.options?.[0]?.value ?? ""}
                          options={field.options ?? []}
                          ariaLabel={field.label}
                          onValueChange={(value) => {
                            setValues((current) => ({
                              ...current,
                              [field.name]: String(value),
                            }));
                            setErrors((current) => ({
                              ...current,
                              [field.name]: "",
                            }));
                          }}
                        />
                      ) : (
                        <input
                          data-autofocus={index === 0 ? "" : undefined}
                          type={
                            field.inputType === "password"
                              ? "password"
                              : field.type === "number"
                                ? "number"
                                : "text"
                          }
                          value={values[field.name] ?? ""}
                          placeholder={field.placeholder}
                          maxLength={field.maxLength}
                          min={field.min}
                          max={field.max}
                          onChange={(event) => {
                            setValues((current) => ({
                              ...current,
                              [field.name]: event.target.value,
                            }));
                            setErrors((current) => ({
                              ...current,
                              [field.name]: "",
                            }));
                          }}
                        />
                      )}
                      {field.type === "directory" && (
                        <button
                          className="secondary-button directory-picker-button"
                          type="button"
                          onClick={async () => {
                            const selected =
                              await window.refCanvas.system.pickDirectory({
                                title: translate("dialogs.pickDirectoryFor").replace("{label}", field.label),
                                defaultPath:
                                  values[field.name]?.trim() || undefined,
                              });
                            if (selected) {
                              setValues((current) => ({
                                ...current,
                                [field.name]: selected,
                              }));
                            }
                          }}
                        >
                          <FolderOpen size={15} />
                          {translate("dialogs.browse")}
                        </button>
                      )}
                    </div>
                    {field.type === "textarea" && field.maxLength && (
                      <small className="form-field-count">
                        {(values[field.name] ?? "").length} / {field.maxLength}
                      </small>
                    )}
                    {errors[field.name] && (
                      <small className="form-field-error">
                        {errors[field.name]}
                      </small>
                    )}
                  </label>
                ))}
                {formError && <p className="form-error">{formError}</p>}
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => close(null)}
                  disabled={submitting}
                >
                  {translate("dialogs.cancel")}
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={submitting}
                >
                  {submitting ? translate("dialogs.processing") : config.confirmLabel ?? translate("dialogs.confirm")}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {confirmConfig && (
        <div
          className="modal-backdrop form-dialog-backdrop"
          onMouseDown={() => closeConfirm(false)}
        >
          <section
            ref={dialogRef}
            className="modal-panel form-dialog confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div className="confirm-dialog-copy">
                <h2 id="confirm-dialog-title">{confirmConfig.title}</h2>
                {confirmConfig.description && (
                  <p>{confirmConfig.description}</p>
                )}
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={translate("dialogs.close")}
                onClick={() => closeConfirm(false)}
              >
                <X size={17} />
              </button>
            </header>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => closeConfirm(false)}
              >
                {translate("dialogs.cancel")}
              </button>
              <button
                type="button"
                data-autofocus=""
                className={`primary-button${confirmConfig.danger ? " danger-button" : ""}`}
                onClick={() => closeConfirm(true)}
              >
                {confirmConfig.confirmLabel ?? translate("dialogs.confirm")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </DialogContext.Provider>
  );
}
