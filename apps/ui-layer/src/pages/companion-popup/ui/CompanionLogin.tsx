import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowUpRight, Monitor, QrCode } from "lucide-react";
import { Surface } from "@qrko/uikit/layout/Surface";
import { Button } from "@/shared/ui/button";
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from "@/shared/ui/disclosure";
import { Input } from "@/shared/ui/input";
import {
  DEVICE_CODE_PATTERN,
  displayDeviceCode,
  type CompanionPopupConfig,
  type CompanionStatus,
} from "../model/companion-popup";

export type CompanionLoginProps = {
  config: CompanionPopupConfig;
  status: CompanionStatus;
  busy: boolean;
  code: string;
  onCodeChange: (value: string) => void;
  onStart: () => void;
  onPair: () => void;
  onRefresh: () => void;
  onOpen: (url: string) => void;
  loginExpired?: boolean;
  error?: string;
};

function verificationLink(
  value: string,
  origin: string,
  code: string,
): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    if (
      url.search ||
      url.username ||
      url.password ||
      url.hash !== `#companion-connect=${displayDeviceCode(code)}`
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function pendingTitle(expired: boolean, showQr: boolean): string {
  if (expired) return "Время входа истекло";
  if (showQr) return "Сканируйте QR или используйте код";
  return "Ваш код входа";
}

function LoginQr({ source, failed }: { source: string; failed: boolean }) {
  if (source) {
    return (
      <img
        className="companion-login-qr"
        src={source}
        width={176}
        height={176}
        alt="QR-код для подтверждения входа в Chrome"
      />
    );
  }
  if (failed) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        QR-код не загрузился. Используйте код входа.
      </p>
    );
  }
  return (
    <div
      className="companion-login-qr grid place-items-center text-sm text-muted-foreground"
      role="status"
    >
      Создаём QR-код…
    </div>
  );
}

export function CompanionLogin({
  config,
  status,
  busy,
  code,
  onCodeChange,
  onStart,
  onPair,
  onRefresh,
  onOpen,
  loginExpired = false,
  error,
}: CompanionLoginProps) {
  const pending = status.pendingLogin;
  const validPending =
    pending &&
    DEVICE_CODE_PATTERN.test(pending.userCode) &&
    Number.isFinite(Date.parse(pending.expiresAt));
  const link = validPending
    ? verificationLink(pending.verificationUri, config.origin, pending.userCode)
    : null;
  const showQr = Boolean(
    validPending &&
    !loginExpired &&
    pending.phoneReachable &&
    link?.startsWith("https://"),
  );
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState(false);
  useEffect(() => {
    let active = true;
    setQr("");
    setQrError(false);
    if (showQr && link) {
      void import("qrcode")
        .then(({ default: qrcode }) =>
          qrcode.toDataURL(link, {
            width: 176,
            margin: 2,
            errorCorrectionLevel: "M",
          }),
        )
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {
          if (active) setQrError(true);
        });
    }
    return () => {
      active = false;
    };
  }, [showQr, link]);

  function handleOpenVerification() {
    if (link) onOpen(link);
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && DEVICE_CODE_PATTERN.test(code.trim())) onPair();
  }
  function handleCodeChange(event: ChangeEvent<HTMLInputElement>) {
    onCodeChange(event.target.value.toUpperCase());
  }

  return (
    <section className="space-y-4" aria-labelledby="companion-login-title">
      <div>
        <h2
          id="companion-login-title"
          tabIndex={-1}
          className="text-xl font-semibold"
        >
          Вход в расширение
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Подтвердите подключение в своём кабинете BudetOffer.
        </p>
      </div>
      {error ? (
        <p role="alert" className="companion-notice text-sm">
          {error}
        </p>
      ) : null}
      {validPending ? (
        <div
          className="companion-section space-y-3"
          aria-labelledby="companion-pending-title"
        >
          <div className="flex items-center gap-2">
            {showQr ? (
              <QrCode className="size-5 text-primary" aria-hidden="true" />
            ) : (
              <Monitor className="size-5 text-primary" aria-hidden="true" />
            )}
            <h3 id="companion-pending-title" className="font-semibold">
              {pendingTitle(loginExpired, showQr)}
            </h3>
          </div>
          {loginExpired ? (
            <>
              <p className="text-sm text-muted-foreground">
                Этот код больше не действует. Получите новый и подтвердите его в
                кабинете.
              </p>
              <Button
                className="w-full"
                disabled={busy}
                loading={busy}
                onClick={onStart}
              >
                Получить новый код
              </Button>
            </>
          ) : (
            <>
              {showQr ? <LoginQr source={qr} failed={qrError} /> : null}
              <div className="companion-code-card">
                <p className="text-center text-3xl font-semibold tracking-widest">
                  <code>{displayDeviceCode(pending.userCode)}</code>
                </p>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Действует до{" "}
                  <time dateTime={pending.expiresAt}>
                    {new Date(pending.expiresAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {showQr
                  ? "Откройте на телефоне, где вы уже вошли в BudetOffer, и подтвердите подключение."
                  : "Откройте кабинет на этом компьютере. Код уже будет в окне подтверждения."}
              </p>
              {link ? (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={handleOpenVerification}
                >
                  Подтвердить в кабинете
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Button>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  Ссылка подтверждения недоступна. Получите новый код.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy} onClick={onRefresh}>
                  Проверить вход
                </Button>
                <Button variant="secondary" disabled={busy} onClick={onStart}>
                  Новый код
                </Button>
              </div>
              {!showQr && !pending.phoneReachable ? (
                <p className="text-xs text-muted-foreground">
                  Для QR-входа с телефона нужен доступный адрес кабинета.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="companion-section space-y-3">
          <p className="text-sm">
            Откройте кабинет в этом Chrome и нажмите «Подключить расширение».
            Если вы уже вошли в кабинет, пароль и ручной код не понадобятся.
          </p>
          <Button
            className="w-full"
            disabled={busy}
            onClick={() =>
              onOpen(
                `${config.origin}/profile?view=connections#companion-devices`,
              )
            }
          >
            Подключить через кабинет
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            loading={busy}
            onClick={onStart}
          >
            Получить код входа
          </Button>
        </div>
      )}
      <Surface padding="none" className="rounded-[var(--radius-panel)]">
        <Disclosure>
          <DisclosureTrigger className="min-h-11 p-3 text-sm text-muted-foreground data-[state=open]:text-foreground">
            У меня уже есть код из кабинета
          </DisclosureTrigger>
          <DisclosureContent>
            <form className="space-y-3 px-3 pb-3" onSubmit={handleSubmit}>
              <label
                htmlFor="companion-login-code"
                className="block text-sm font-semibold"
              >
                Код из кабинета
              </label>
              <Input
                id="companion-login-code"
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="4GN-5TY"
                maxLength={7}
                value={code}
                onChange={handleCodeChange}
                aria-describedby="companion-code-help"
                disabled={busy}
              />
              <p
                id="companion-code-help"
                className="text-xs text-muted-foreground"
              >
                Шесть символов без 0, O, 1, I и L. Код можно вставить.
              </p>
              <Button
                className="w-full"
                type="submit"
                disabled={busy || !DEVICE_CODE_PATTERN.test(code.trim())}
                loading={busy}
              >
                Войти по коду
              </Button>
            </form>
          </DisclosureContent>
        </Disclosure>
      </Surface>
    </section>
  );
}
