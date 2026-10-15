import { useCallback, useEffect, useRef, useState } from "react";
import { resolveCompanionEwans } from "@/shared/api/ewans";
import {
  DEVICE_CODE_PATTERN,
  displayDeviceCode,
  type CompanionMessage,
  type CompanionPopupClient,
  type CompanionPopupConfig,
  type CompanionStatus,
} from "./companion-popup";

export type CompanionConnectionStage =
  "loading" | "login" | "onboarding" | "ready" | "unavailable" | "conflict";
type ConnectionSnapshot = {
  status: CompanionStatus | null;
  error: string;
  unavailable: boolean;
};
const CHECK_ERROR =
  "Не удалось связаться с расширением. Повторите проверку подключения.";
const ACTION_ERROR =
  "Ответ не получен. Проверьте подключение перед повтором действия.";
// Older workers return these local constants instead of a coded descriptor.
// Arbitrary runtime/server strings are never rendered as fallback messages.
const LEGACY_WORKER_ERRORS = new Set([
  "Не удалось изменить подключение. Проверьте код и состояние заданий в приложении.",
  "Сервер недоступен. Проверьте подключение и включённый компьютер. Фоновая проверка повторится автоматически.",
  "Код входа истёк. Получите новый код в расширении.",
  "Подключение расширения отозвано или срок входа истёк. Войдите снова; незавершённые задания сохраняются для сверки.",
]);

function workerProblem(
  status: CompanionStatus,
  legacy: string | undefined,
): string {
  if (status.ewans) return resolveCompanionEwans(status.ewans);
  if (legacy && LEGACY_WORKER_ERRORS.has(legacy)) return legacy;
  return "Не удалось проверить подключение. Повторите проверку.";
}
type CompanionChangeArguments =
  | [type: "chairs:pair-device", options: { code: string }]
  | [type: Exclude<CompanionMessage["type"], "chairs:pair-device">];

function connectionMessage(
  origin: string,
  args: CompanionChangeArguments,
): CompanionMessage {
  switch (args[0]) {
    case "chairs:device-status":
    case "chairs:disconnect-device":
      return { type: args[0], origin };
    case "chairs:start-device-login":
      return { type: args[0], origin, label: "Chrome на этом компьютере" };
    case "chairs:pair-device":
      return {
        type: args[0],
        origin,
        label: "Chrome на этом компьютере",
        code: displayDeviceCode(args[1].code),
      };
    case "chairs:accept-onboarding":
      return {
        type: args[0],
        origin,
        adult: true,
        terms: true,
        privacy: true,
        computerAwake: true,
        version: "2026-10-10",
      };
  }
}

function statusProblem(status: CompanionStatus, origin: string): string {
  if (!status.ok) {
    return workerProblem(status, status.error);
  }
  if (typeof status.paired !== "boolean") {
    return "Расширение не подтвердило состояние подключения. Повторите проверку.";
  }
  if (
    status.paired &&
    (!status.origin ||
      !status.expiresAt ||
      typeof status.onboardingRequired !== "boolean")
  ) {
    return "Не удалось проверить подключение и обязательные условия. Повторите проверку.";
  }
  if (
    status.expiresAt != null &&
    !Number.isFinite(Date.parse(status.expiresAt))
  ) {
    return "Не удалось проверить срок подключения. Повторите проверку.";
  }
  const pending = status.pendingLogin;
  if (pending) {
    if (
      !DEVICE_CODE_PATTERN.test(pending.userCode) ||
      !Number.isFinite(Date.parse(pending.expiresAt))
    ) {
      return "Не удалось проверить код входа. Получите новый код.";
    }
    try {
      const uri = new URL(pending.verificationUri);
      if (
        uri.origin !== origin ||
        !["http:", "https:"].includes(uri.protocol)
      ) {
        return "Адрес подтверждения не соответствует этому кабинету. Повторите проверку.";
      }
    } catch {
      return "Не удалось проверить адрес подтверждения. Повторите проверку.";
    }
  }
  return "";
}

function connectionStage(
  snapshot: ConnectionSnapshot,
  origin: string,
  now: number,
): CompanionConnectionStage {
  if (snapshot.unavailable) return "unavailable";
  const status = snapshot.status;
  if (!status) return "loading";
  if (status.paired && (status.origin !== origin || status.pendingLogin)) {
    return "conflict";
  }
  if (!status.paired) return "login";
  if (status.expiresAt && Date.parse(status.expiresAt) <= now) {
    return "unavailable";
  }
  if (status.onboardingRequired === true) return "onboarding";
  return status.onboardingRequired === false ? "ready" : "unavailable";
}

export function useCompanionConnection({
  client,
  config,
}: {
  client: CompanionPopupClient;
  config: CompanionPopupConfig;
}) {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>({
    status: null,
    error: "",
    unavailable: false,
  });
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const current = useRef(snapshot);
  const mounted = useRef(false);
  const working = useRef(false);
  const revision = useRef(0);
  const lifecycle = useRef(0);
  const refreshAfterChange = useRef(false);
  const activeContext = useRef<{
    client: CompanionPopupClient;
    origin: string;
    serverOnly: boolean;
  } | null>(null);
  const requestedContext = useRef({
    client,
    origin: config.origin,
    serverOnly: config.serverOnly,
  });
  requestedContext.current = {
    client,
    origin: config.origin,
    serverOnly: config.serverOnly,
  };
  current.current = snapshot;

  const isCurrentConnection = useCallback(() => {
    const active = activeContext.current;
    const requested = requestedContext.current;
    return (
      mounted.current &&
      active?.client === client &&
      active.origin === config.origin &&
      active.serverOnly === config.serverOnly &&
      requested.client === client &&
      requested.origin === config.origin &&
      requested.serverOnly === config.serverOnly
    );
  }, [client, config.origin, config.serverOnly]);

  const apply = useCallback(
    (next: CompanionStatus) => {
      const problem = statusProblem(next, config.origin);
      const status = next.backgroundError
        ? {
            ...next,
            backgroundError: workerProblem(next, next.backgroundError),
          }
        : next;
      setNow(Date.now());
      setSnapshot((previous) =>
        problem
          ? { ...previous, error: problem, unavailable: true }
          : { status, error: "", unavailable: false },
      );
      return !problem;
    },
    [config.origin],
  );

  const update = useCallback(async () => {
    if (!isCurrentConnection()) return;
    if (working.current) {
      refreshAfterChange.current = true;
      return;
    }
    const request = ++revision.current;
    const generation = lifecycle.current;
    setChecking(true);
    try {
      const next = await client.send({
        type: "chairs:device-status",
        origin: config.origin,
      });
      if (
        isCurrentConnection() &&
        lifecycle.current === generation &&
        revision.current === request &&
        !working.current
      ) {
        apply(next);
      }
    } catch {
      if (
        isCurrentConnection() &&
        lifecycle.current === generation &&
        revision.current === request &&
        !working.current
      ) {
        setSnapshot((previous) => ({
          ...previous,
          error: CHECK_ERROR,
          unavailable: true,
        }));
      }
    } finally {
      if (
        isCurrentConnection() &&
        lifecycle.current === generation &&
        revision.current === request
      ) {
        setChecking(false);
      }
    }
  }, [apply, client, config.origin, isCurrentConnection]);

  useEffect(() => {
    mounted.current = true;
    lifecycle.current++;
    activeContext.current = {
      client,
      origin: config.origin,
      serverOnly: config.serverOnly,
    };
    working.current = false;
    refreshAfterChange.current = false;
    setSnapshot({ status: null, error: "", unavailable: false });
    setBusy(false);
    void update();
    const unsubscribe = client.subscribe(() => {
      void update();
    });
    const visible = () => {
      if (document.visibilityState === "visible") void update();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      activeContext.current = null;
      // Unmounted responses fail isCurrentConnection; the next setup advances
      // the generation before accepting responses from that lifecycle.
      unsubscribe();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, config.origin, config.serverOnly, update]);

  const contextMatches =
    activeContext.current?.client === client &&
    activeContext.current.origin === config.origin &&
    activeContext.current.serverOnly === config.serverOnly;
  const status = contextMatches ? snapshot.status : null;
  const deadline = status?.paired
    ? status.expiresAt
    : status?.pendingLogin?.expiresAt;
  useEffect(() => {
    if (!deadline) return;
    const remaining = Date.parse(deadline) - Date.now();
    if (remaining <= 0 || !Number.isFinite(remaining)) return;
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
        void update();
      },
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [deadline, now, update]);

  const stage = contextMatches
    ? connectionStage(snapshot, config.origin, now)
    : "loading";
  const loginExpired =
    !!status?.pendingLogin && Date.parse(status.pendingLogin.expiresAt) <= now;

  const change = useCallback(
    async (...args: CompanionChangeArguments): Promise<boolean> => {
      const [type] = args;
      if (!isCurrentConnection() || working.current) return false;
      if (type === "chairs:device-status") {
        await update();
        return true;
      }
      const snapshot = current.current;
      const stage = connectionStage(snapshot, config.origin, Date.now());
      if (type === "chairs:accept-onboarding" && stage !== "onboarding") {
        return false;
      }
      if (
        (type === "chairs:start-device-login" ||
          type === "chairs:pair-device") &&
        stage !== "login"
      ) {
        return false;
      }
      if (
        args[0] === "chairs:pair-device" &&
        !DEVICE_CODE_PATTERN.test(args[1].code.trim())
      ) {
        return false;
      }
      const message = connectionMessage(config.origin, args);
      working.current = true;
      refreshAfterChange.current = false;
      setBusy(true);
      setChecking(false);
      setSnapshot((previous) => ({ ...previous, error: "" }));
      const request = ++revision.current;
      const generation = lifecycle.current;
      try {
        const next = await client.send(message);
        if (
          !isCurrentConnection() ||
          lifecycle.current !== generation ||
          revision.current !== request
        ) {
          return false;
        }
        return apply(next);
      } catch {
        if (
          isCurrentConnection() &&
          lifecycle.current === generation &&
          revision.current === request
        ) {
          setSnapshot((previous) => ({
            ...previous,
            error: ACTION_ERROR,
            unavailable: true,
          }));
        }
        return false;
      } finally {
        if (isCurrentConnection() && lifecycle.current === generation) {
          working.current = false;
          setBusy(false);
          if (refreshAfterChange.current) {
            refreshAfterChange.current = false;
            void update();
          }
        }
      }
    },
    [apply, client, config.origin, isCurrentConnection, update],
  );

  const open = useCallback(
    async (url: string) => {
      if (!isCurrentConnection()) return;
      const generation = lifecycle.current;
      try {
        await client.open(url);
      } catch {
        if (isCurrentConnection() && lifecycle.current === generation) {
          setSnapshot((previous) => ({
            ...previous,
            error: "Не удалось открыть страницу. Повторите действие.",
          }));
        }
      }
    },
    [client, isCurrentConnection],
  );

  let error = "";
  if (contextMatches) {
    error = snapshot.error;
    if (
      !error &&
      stage === "unavailable" &&
      status?.expiresAt &&
      Date.parse(status.expiresAt) <= now
    ) {
      error = "Подключение истекло. Повторите проверку и войдите снова.";
    }
  }
  return {
    status,
    busy: contextMatches && busy,
    error,
    checking: !contextMatches || checking,
    stage,
    loginExpired,
    update,
    change,
    open,
  };
}
