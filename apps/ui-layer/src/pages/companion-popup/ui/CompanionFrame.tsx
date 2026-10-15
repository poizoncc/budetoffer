import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Surface } from "@qrko/uikit/layout/Surface";
import { UiPresentationProvider } from "@qrko/uikit/layout/UiPresentation";

export type CompanionFrameStage =
  "loading" | "login" | "onboarding" | "ready" | "unavailable" | "conflict";
export type CompanionFrameProps = {
  stage: CompanionFrameStage;
  children: ReactNode;
  statusLabel?: string;
  logoUrl?: string;
  footer?: ReactNode;
};

const steps = ["Вход", "Условия", "Готово"];
const stageLabels: Record<CompanionFrameStage, string> = {
  loading: "Проверяем подключение",
  login: "Вход ещё не выполнен",
  onboarding: "Осталось подтвердить условия",
  ready: "Расширение подключено",
  unavailable: "Подключение недоступно",
  conflict: "Нужно проверить подключение",
};
const stageSteps: Record<CompanionFrameStage, number> = {
  loading: -1,
  login: 0,
  onboarding: 1,
  ready: 2,
  unavailable: -1,
  conflict: -1,
};

export function CompanionFrame({
  stage,
  children,
  statusLabel,
  logoUrl,
  footer,
}: CompanionFrameProps) {
  const activeStep = stageSteps[stage];
  return (
    <UiPresentationProvider presentation="unified">
      <main className="companion-popup" data-stage={stage}>
        <Surface padding="none" className="companion-frame">
          <header className="companion-frame-header">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="companion-brand" />
                ) : null}
                <h1 className="text-xl font-bold tracking-tight">BudetOffer</h1>
              </div>
              <span className="text-xs text-muted-foreground">Для Chrome</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {statusLabel || stageLabels[stage]}
            </p>
            <ol className="companion-steps" aria-label="Подключение расширения">
              {steps.map((label, index) => (
                <li
                  key={label}
                  aria-current={index === activeStep ? "step" : undefined}
                  data-complete={
                    activeStep > index || stage === "ready" ? "true" : "false"
                  }
                >
                  <span className="companion-step-number" aria-hidden="true">
                    {activeStep > index || stage === "ready" ? (
                      <Check className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          </header>
          <div className="companion-frame-content">{children}</div>
          {footer ? (
            <footer className="companion-frame-footer">{footer}</footer>
          ) : null}
        </Surface>
      </main>
    </UiPresentationProvider>
  );
}
