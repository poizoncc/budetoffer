import { createCompanionTransport } from "./transport.ts";
import { createCheckpointStore } from "./checkpoint-store.ts";
import { createCompanionWorker } from "./service-worker.ts";
import { createChromeExecution } from "./execution.ts";
import { createPackagedApplicationExecutor } from "./application-execution.ts";
import { COMPANION_ORIGINS } from "../shared/destinations.ts";
import { COMPANION_ONBOARDING } from "../shared/onboarding.ts";
import {
  ONBOARDING_KEY,
  legalLinks,
  onboardingAccepted,
  acceptedOnboarding,
} from "./onboarding.ts";
import type { OnboardingConfig } from "./onboarding.ts";
import {
  LOGIN_KEY,
  LOGIN_ALARM,
  pairingCode,
  validDevice,
  validPendingLogin,
  publicPendingLogin,
  publicLoginRequest,
} from "./device-login.ts";
import type { Device } from "./device-login.ts";
import { errorMessage, isRecord } from "../shared/record.ts";
import type {
  CompanionJob,
  CompanionTransport,
} from "../shared/companion-protocol.ts";
import type { PairedChromeApi } from "../shared/chrome-api.ts";

const KEY = "chairs-companion-device-v1";
const ORIGINS = new Set<string>(COMPANION_ORIGINS);
const ALARM = "chairs-companion-poll";
const ERROR_KEY = "chairs-companion-background-error-v1";
const UNAVAILABLE =
  "Сервер недоступен. Проверьте подключение и включённый компьютер. Фоновая проверка повторится автоматически.";

export function installPairedCompanion(
  chromeApi: PairedChromeApi,
  fetchImpl: typeof fetch = fetch,
  {
    now = () => Date.now(),
    onboardingConfig = COMPANION_ONBOARDING,
  }: { now?: () => number; onboardingConfig?: OnboardingConfig } = {},
) {
  const storage = chromeApi.storage.local;
  const checkpoints = createCheckpointStore(storage);
  let running = false;
  let pairing = false;
  const read = async (): Promise<unknown> => (await storage.get(KEY))[KEY];
  const readPending = async (): Promise<unknown> =>
    (await storage.get(LOGIN_KEY))[LOGIN_KEY];
  const valid = (value: unknown): value is Device =>
    validDevice(value, ORIGINS, now());
  const consent = async (device: Device) =>
    onboardingAccepted(
      (await storage.get(ONBOARDING_KEY))[ONBOARDING_KEY],
      device,
      onboardingConfig,
    );
  async function ensureAlarm(name: string, periodInMinutes: number) {
    const existing = await chromeApi.alarms.get?.(name);
    if (!existing) await chromeApi.alarms.create(name, { periodInMinutes });
  }
  async function ensureAlarms() {
    await ensureAlarm(ALARM, 1);
    if (validPendingLogin(await readPending(), ORIGINS, now())) {
      await ensureAlarm(LOGIN_ALARM, 0.5);
    } else await chromeApi.alarms.clear?.(LOGIN_ALARM);
  }
  const ready = (async () => {
    await storage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    // Chrome may remove alarms across a restart or extension update. Restore
    // them on every worker activation, independently of the popup lifecycle.
    await ensureAlarms();
  })();
  const status = async () => {
    await ready;
    const device = await read();
    const checkpoint = await checkpoints.load();
    const pending = await readPending();
    const backgroundError = (await storage.get(ERROR_KEY))[ERROR_KEY];
    return {
      paired: !!valid(device),
      origin: valid(device) ? device.origin : null,
      expiresAt: valid(device) ? device.expiresAt : null,
      onboardingRequired: !!valid(device) && !(await consent(device)),
      onboardingVersion: onboardingConfig.version,
      legalLinks: legalLinks(onboardingConfig),
      requiresReconciliation:
        !!checkpoint?.reconcileOriginal ||
        checkpoint?.phase === "reconciling" ||
        checkpoint?.phase === "authorized" ||
        checkpoint?.receipt?.outcome === "unknown",
      ...(validPendingLogin(pending, ORIGINS, now())
        ? { pendingLogin: publicPendingLogin(pending) }
        : {}),
      ...(typeof backgroundError === "string" ? { backgroundError } : {}),
    };
  };
  async function saveDevice(origin: string, response: unknown) {
    if (!isRecord(response)) throw new Error("invalid_pairing_response");
    const device = { ...response, origin };
    if (!valid(device)) throw new Error("invalid_pairing_response");
    // A replacement device cannot inherit previous agreements or enable work.
    // Checkpoints deliberately remain untouched, including uncertain mutations.
    await storage.set({
      [KEY]: {
        origin,
        deviceId: device.deviceId,
        accessToken: device.accessToken,
        expiresAt: device.expiresAt,
      },
      [ONBOARDING_KEY]: null,
      [LOGIN_KEY]: null,
      [ERROR_KEY]: null,
    });
    await chromeApi.alarms.clear?.(LOGIN_ALARM);
  }
  const pair = async ({
    origin,
    code,
    label,
  }: {
    origin: unknown;
    code: unknown;
    label: unknown;
  }) => {
    await ready;
    if (pairing || running) throw new Error("companion_busy");
    const normalized = pairingCode(code);
    if (
      typeof origin !== "string" ||
      !ORIGINS.has(origin) ||
      !normalized ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 100
    ) {
      throw new Error("invalid_pairing");
    }
    pairing = true;
    try {
      // A replacement credential may recover the owner's original job. Pairing
      // never clears a checkpoint or changes an uncertain job's outcome.
      await checkpoints.load();
      const response = await fetchImpl(
        `${origin}/api/v1/companion/devices/redeem`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: normalized, label: label.trim() }),
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error("pairing_rejected");
      const device: unknown = await response.json();
      await saveDevice(origin, device);
      return status();
    } finally {
      pairing = false;
    }
  };
  const startLogin = async ({
    origin,
    label,
  }: {
    origin: unknown;
    label: unknown;
  }) => {
    await ready;
    if (pairing || running) throw new Error("companion_busy");
    if (
      typeof origin !== "string" ||
      !ORIGINS.has(origin) ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 100
    ) {
      throw new Error("invalid_pairing");
    }
    pairing = true;
    try {
      if (valid(await read())) throw new Error("companion_busy");
      const previous = await readPending();
      if (
        validPendingLogin(previous, ORIGINS, now()) &&
        previous.origin !== origin
      ) {
        throw new Error("companion_busy");
      }
      const value = await publicLoginRequest(
        fetchImpl,
        origin,
        "device-login/start",
        { label: label.trim() },
      );
      const pending = {
        origin,
        deviceCode: value.deviceCode,
        userCode: value.userCode,
        expiresAt: value.expiresAt,
        intervalSeconds: value.intervalSeconds,
        nextPollAt: now() + value.intervalSeconds * 1000,
      };
      if (!validPendingLogin(pending, ORIGINS, now())) {
        throw new Error("invalid_login_response");
      }
      await storage.set({ [LOGIN_KEY]: pending, [ERROR_KEY]: null });
      await ensureAlarm(LOGIN_ALARM, 0.5);
      return status();
    } finally {
      pairing = false;
    }
  };
  const pollLogin = async () => {
    await ready;
    if (pairing || running) return;
    pairing = true;
    try {
      const pending = await readPending();
      if (!validPendingLogin(pending, ORIGINS, now())) {
        if (pending) {
          await storage.set({
            [LOGIN_KEY]: null,
            [ERROR_KEY]: "Код входа истёк. Получите новый код в расширении.",
          });
          await chromeApi.alarms.clear?.(LOGIN_ALARM);
        }
        return;
      }
      if (now() < pending.nextPollAt) return;
      // Persist the throttle before the request, so a worker restart or repeated
      // popup refresh cannot poll faster than the server's advertised interval.
      await storage.set({
        [LOGIN_KEY]: {
          ...pending,
          nextPollAt: now() + pending.intervalSeconds * 1000,
        },
      });
      const result = await publicLoginRequest(
        fetchImpl,
        pending.origin,
        "device-login/poll",
        { deviceCode: pending.deviceCode },
      );
      if (result.state === "approved") await saveDevice(pending.origin, result);
      else if (result.state === "expired") {
        await storage.set({
          [LOGIN_KEY]: null,
          [ERROR_KEY]: "Код входа истёк. Получите новый код в расширении.",
        });
        await chromeApi.alarms.clear?.(LOGIN_ALARM);
      } else if (result.state === "pending") {
        await storage.set({ [ERROR_KEY]: null });
      } else throw new Error("invalid_login_response");
    } catch (error) {
      if (errorMessage(error) === "login_expired") {
        await storage.set({
          [LOGIN_KEY]: null,
          [ERROR_KEY]: "Код входа истёк. Получите новый код в расширении.",
        });
        await chromeApi.alarms.clear?.(LOGIN_ALARM);
      } else await storage.set({ [ERROR_KEY]: UNAVAILABLE });
    } finally {
      pairing = false;
    }
  };
  const acceptOnboarding = async (message: unknown) => {
    await ready;
    if (pairing || running) throw new Error("companion_busy");
    pairing = true;
    try {
      const device = await read();
      if (!valid(device)) throw new Error("device_not_paired");
      await storage.set({
        [ONBOARDING_KEY]: acceptedOnboarding(
          message,
          device,
          onboardingConfig,
          now(),
        ),
        [ERROR_KEY]: null,
      });
      await ensureAlarms();
      return status();
    } finally {
      pairing = false;
    }
  };
  const tick = async () => {
    await ready;
    if (running || pairing) return;
    running = true;
    try {
      const device = await read();
      if (!valid(device) || !(await consent(device))) return;
      const transport = createCompanionTransport({
        origin: device.origin,
        token: async () => {
          const current = await read();
          if (
            !valid(current) ||
            current.deviceId !== device.deviceId ||
            current.origin !== device.origin ||
            !(await consent(current))
          ) {
            return null;
          }
          return current.accessToken;
        },
        fetchImpl,
      });
      const reader = createChromeExecution(chromeApi, transport, checkpoints);
      const application = createPackagedApplicationExecutor(
        chromeApi,
        transport,
        checkpoints,
      );
      const executor = {
        identity: reader.identity,
        execute: (job: CompanionJob) =>
          job.kind === "apply_vacancy" ? application(job) : reader.execute(job),
      };
      await transport.heartbeat(await executor.identity());
      let previous = await checkpoints.load();
      let reconcileOriginalJobId: string | undefined;
      if (previous) {
        let sameDevice =
          previous.deviceId === device.deviceId &&
          previous.origin === device.origin;
        if (!sameDevice && previous.reconcileOriginal) {
          // An abandoned READ lease is safe to expire. Preserve the original
          // mutation uncertainty rather than replaying another device's token.
          previous = previous.reconcileOriginal;
          await checkpoints.save(previous);
          sameDevice =
            previous.deviceId === device.deviceId &&
            previous.origin === device.origin;
        }
        if (
          !sameDevice ||
          previous.reconcileOriginal ||
          ["authorized", "reconciling"].includes(previous.phase) ||
          previous.receipt?.outcome === "unknown"
        ) {
          const originalId =
            previous.reconcileOriginal?.jobId ?? previous.jobId;
          const recovered = await transport.recovery(originalId);
          if (
            !isRecord(recovered) ||
            recovered.jobId !== originalId ||
            typeof recovered.state !== "string"
          ) {
            throw new Error("invalid_recovery_response");
          }
          if (["completed", "blocked", "cancelled"].includes(recovered.state)) {
            await checkpoints.clear();
            return;
          }
          // Only a server-scoped read lease can cross an uncertain account lock.
          if (
            !previous.reconcileOriginal &&
            ["mutation_authorized", "reconciling"].includes(recovered.state)
          ) {
            reconcileOriginalJobId = originalId;
          } else if (!sameDevice) return;
        }
      }
      const boundTransport: CompanionTransport = {
        ...transport,
        lease: async (originalId?: string) => {
          const job = await transport.lease(originalId);
          return job
            ? { ...job, deviceId: device.deviceId, origin: device.origin }
            : null;
        },
      };
      await createCompanionWorker({
        transport: boundTransport,
        checkpoints,
        execute: executor.execute,
      }).tick(reconcileOriginalJobId);
      await storage.set({ [ERROR_KEY]: null });
    } catch (error) {
      if (errorMessage(error) !== "companion_http_401") throw error;
      // Only authentication failure revokes local credentials. A missing
      // entitlement (403), network failure or blocked HH job keeps pairing.
      // Never discard the checkpoint: an uncertain submission still needs an
      // owner-authenticated replacement device to reconcile its exact result.
      await storage.remove([KEY, ONBOARDING_KEY]);
      await storage.set({
        [ERROR_KEY]:
          "Подключение расширения отозвано или срок входа истёк. Войдите снова; незавершённые задания сохраняются для сверки.",
      });
    } finally {
      running = false;
    }
  };
  const boundedTick = () => {
    void tick()
      .catch(() => storage.set({ [ERROR_KEY]: UNAVAILABLE }))
      .catch(() => {});
  };
  const resume = () => {
    void (async () => {
      await ready;
      await ensureAlarms();
      await pollLogin();
      boundedTick();
    })()
      .catch(() => storage.set({ [ERROR_KEY]: UNAVAILABLE }))
      .catch(() => {});
  };
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) boundedTick();
    if (alarm.name === LOGIN_ALARM) void pollLogin().catch(() => {});
  });
  chromeApi.runtime.onStartup.addListener(resume);
  chromeApi.runtime.onInstalled?.addListener(resume);
  chromeApi.runtime.onMessage.addListener(
    (message: unknown, sender, respond: (value: unknown) => void) => {
      if (
        !isRecord(message) ||
        typeof message.type !== "string" ||
        ![
          "chairs:device-status",
          "chairs:pair-device",
          "chairs:disconnect-device",
          "chairs:start-device-login",
          "chairs:accept-onboarding",
        ].includes(message.type)
      ) {
        return false;
      }
      if (
        sender.id !== chromeApi.runtime.id ||
        sender.url !== chromeApi.runtime.getURL("popup/index.html")
      ) {
        return false;
      }
      const action = async () => {
        if (message.type === "chairs:pair-device") {
          return pair({
            origin: message.origin,
            code: message.code,
            label: message.label,
          });
        }
        if (message.type === "chairs:start-device-login") {
          return startLogin({ origin: message.origin, label: message.label });
        }
        if (message.type === "chairs:accept-onboarding") {
          return acceptOnboarding(message);
        }
        if (message.type === "chairs:disconnect-device") {
          await ready;
          if (running || pairing) throw new Error("companion_busy");
          pairing = true;
          try {
            await storage.remove([KEY, ONBOARDING_KEY, LOGIN_KEY, ERROR_KEY]); // Retain uncertain job checkpoints for reconciliation.
            await chromeApi.alarms.clear?.(LOGIN_ALARM);
          } finally {
            pairing = false;
          }
        }
        if (message.type === "chairs:device-status") await pollLogin();
        return status();
      };
      void action().then(
        (value) => respond({ ok: true, ...value }),
        () =>
          respond({
            ok: false,
            error:
              "Не удалось изменить подключение. Проверьте код и состояние заданий в приложении.",
          }),
      );
      return true;
    },
  );
  resume();
  return { pair, status, tick, startLogin, pollLogin, acceptOnboarding };
}

if (globalThis.chrome?.runtime?.id) installPairedCompanion(globalThis.chrome);
