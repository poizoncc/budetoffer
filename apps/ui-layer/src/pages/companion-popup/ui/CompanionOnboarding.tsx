import { useState } from "react";
import { Switch } from "@qrko/uikit/shadcn/switch";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  validLegalLink,
  type CompanionLegalLinks,
} from "../model/companion-popup";

type OnboardingProps = {
  origin: string;
  legalLinks?: CompanionLegalLinks;
  busy: boolean;
  onAccept: () => void;
  onOpenDocument: (url: string) => void;
};
export function CompanionOnboarding({
  origin,
  legalLinks,
  busy,
  onAccept,
  onOpenDocument,
}: OnboardingProps) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [awake, setAwake] = useState(false);
  const termsReady = validLegalLink(legalLinks?.termsUrl, origin);
  const privacyReady = validLegalLink(legalLinks?.privacyUrl, origin);
  const canContinue =
    adult && terms && privacy && awake && termsReady && privacyReady;
  function handleOpenTerms() {
    const url = legalLinks?.termsUrl;
    if (validLegalLink(url, origin)) onOpenDocument(new URL(url, origin).href);
  }
  function handleOpenPrivacy() {
    const url = legalLinks?.privacyUrl;
    if (validLegalLink(url, origin)) onOpenDocument(new URL(url, origin).href);
  }
  return (
    <section
      className="companion-onboarding space-y-4"
      aria-labelledby="companion-onboarding-title"
    >
      <div>
        <h2
          id="companion-onboarding-title"
          tabIndex={-1}
          className="text-xl font-semibold"
        >
          Перед началом работы
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Подтвердите четыре пункта, чтобы завершить подключение.
        </p>
      </div>
      <section
        className="companion-section space-y-3"
        aria-labelledby="companion-computer-title"
      >
        <h3 id="companion-computer-title" className="font-semibold">
          Работа компьютера
        </h3>
        <p className="text-sm text-muted-foreground">
          Компьютер должен быть включён, Chrome — открыт. Вкладку HH и это окно
          можно свернуть. Сон компьютера или закрытие Chrome приостанавливают
          работу.
        </p>
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <Checkbox
            checked={awake}
            onCheckedChange={setAwake}
            disabled={busy}
            aria-label="Компьютер и Chrome останутся включёнными"
          />
          <span className="text-sm">
            Понимаю, что компьютер и Chrome должны оставаться включёнными.
          </span>
        </label>
      </section>
      <section
        className="companion-section space-y-3"
        aria-labelledby="companion-documents-title"
      >
        <h3 id="companion-documents-title" className="font-semibold">
          Возраст и документы
        </h3>
        <div>
          <div className="flex min-h-11 items-center gap-4">
            <Switch
              id="companion-adult"
              checked={adult}
              onCheckedChange={setAdult}
              disabled={busy}
              labeled
              labelChecked="Да"
              labelUnchecked="Нет"
              density="touch"
              presentation="unified"
              aria-describedby="companion-adult-help"
            />
            <label htmlFor="companion-adult">Мне есть 18</label>
          </div>
          <p
            id="companion-adult-help"
            className="mt-2 text-xs text-muted-foreground"
          >
            Мы не можем проверить ваш возраст и полагаемся на вашу честность и
            ответственность.
          </p>
        </div>
        <div className="flex min-h-11 items-start gap-3">
          <Checkbox
            id="companion-terms"
            checked={terms}
            onCheckedChange={setTerms}
            disabled={busy || !termsReady}
            aria-label="Принимаю пользовательское соглашение"
          />
          <span className="text-sm">
            <label htmlFor="companion-terms">Принимаю </label>
            {termsReady ? (
              <button
                type="button"
                className="companion-document-link"
                onClick={handleOpenTerms}
              >
                Пользовательское соглашение
              </button>
            ) : (
              <span>Пользовательское соглашение</span>
            )}
          </span>
        </div>
        <div className="flex min-h-11 items-start gap-3">
          <Checkbox
            id="companion-privacy"
            checked={privacy}
            onCheckedChange={setPrivacy}
            disabled={busy || !privacyReady}
            aria-label="Соглашаюсь с политикой конфиденциальности"
          />
          <span className="text-sm">
            <label htmlFor="companion-privacy">Соглашаюсь с </label>
            {privacyReady ? (
              <button
                type="button"
                className="companion-document-link"
                onClick={handleOpenPrivacy}
              >
                Политикой конфиденциальности
              </button>
            ) : (
              <span>Политикой конфиденциальности</span>
            )}
          </span>
        </div>
        {!termsReady || !privacyReady ? (
          <p role="status" className="text-sm text-muted-foreground">
            Ссылки на документы ещё не настроены. Оператор должен добавить их
            перед завершением входа.
          </p>
        ) : null}
      </section>
      <Button
        className="w-full"
        disabled={busy || !canContinue}
        loading={busy}
        onClick={onAccept}
      >
        Продолжить
      </Button>
    </section>
  );
}
