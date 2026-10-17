import { readVerifiedAccountIdentity, accountMatches } from "../hh/account.ts";
import { readPageEvidence } from "../hh/actions.ts";
import type {
  PageEvidenceRequest,
  HistoryFilter,
  HistoryObservation,
} from "../hh/actions.ts";
import { readHistoryAccountIdentity } from "../hh/history-account.ts";
import { readApplicationOutcomesPage } from "../hh/outcomes.ts";
import { readFullHistoryPage } from "../hh/full-history.ts";
import { readChatSnapshot } from "../hh/chat-snapshot.ts";
import { MAX_HISTORY_PAGES } from "../hh/history-limits.ts";
import { readPublicationResumeArtifacts } from "./publication.ts";
import { executeJob, blockedReceipt } from "../hh/executor.ts";
import { requireRunnableTab } from "./tab-state.ts";
import { isRecord } from "../shared/record.ts";
import type {
  CompanionJob,
  CompanionTransport,
  CheckpointStore,
  JobResult,
  OutcomeObservation,
  FullHistoryObservation,
  SearchVacancy,
  ResumeEvidence,
  CapturedConversation,
} from "../shared/companion-protocol.ts";
import type { CompanionTab, ExecutionChromeApi } from "../shared/chrome-api.ts";

const HH = "https://hh.ru";
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const vacancyId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{0,19}$/u.test(value);

// HH may redirect its canonical host to a regional host. Read-only jobs still
// target the exact same resource, and verify the account before and after it.
function sameReadTarget(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  try {
    const source = new URL(actual);
    const target = new URL(expected);
    const hh = (url: URL) =>
      url.protocol === "https:" &&
      /(^|\.)hh\.ru$/u.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash;
    return (
      hh(source) &&
      hh(target) &&
      source.pathname === target.pathname &&
      source.search === target.search
    );
  } catch {
    return false;
  }
}

function hasPendingNavigation(tab: CompanionTab): boolean {
  return typeof tab.pendingUrl === "string" && tab.pendingUrl.length > 0;
}

function committedReadTarget(tab: CompanionTab, expected: string): boolean {
  return (
    tab.status === "complete" &&
    !hasPendingNavigation(tab) &&
    sameReadTarget(tab.url, expected)
  );
}

export function createChromeExecution(
  chromeApi: ExecutionChromeApi,
  transport: Pick<CompanionTransport, "publicDetails"> | null,
  checkpoints: Pick<CheckpointStore, "load"> | null,
) {
  let running = false;
  async function inject<Args extends unknown[], Result>(
    tabId: number,
    func: (...args: Args) => Result,
    args: Args,
    documentId?: string,
  ) {
    const tab = requireRunnableTab(await chromeApi.tabs.get(tabId));
    if (tab.status !== "complete" || hasPendingNavigation(tab)) {
      throw new Error("unexpected_hh_navigation");
    }
    let source;
    try {
      if (typeof tab.url !== "string") throw new Error();
      source = new URL(tab.url);
    } catch {
      throw new Error("unexpected_hh_navigation");
    }
    if (
      source.protocol !== "https:" ||
      !/(^|\.)hh\.ru$/u.test(source.hostname) ||
      source.username ||
      source.password ||
      source.port
    ) {
      throw new Error("unexpected_hh_navigation");
    }
    const response = await chromeApi.scripting.executeScript<Args, Result>({
      target: {
        tabId,
        ...(documentId ? { documentIds: [documentId] } : { frameIds: [0] }),
      },
      world: "ISOLATED",
      func,
      args,
    });
    if (
      !Array.isArray(response) ||
      response.length !== 1 ||
      response[0]?.frameId !== 0 ||
      ("error" in response[0] && response[0].error) ||
      response[0].result === undefined
    ) {
      throw new Error("hh_read_failed");
    }
    return { value: response[0].result, documentId: response[0].documentId };
  }
  async function historyIdentity(
    tabId: number,
    documentId?: string,
    allowEmpty = false,
  ) {
    const observed = await inject(
      tabId,
      readHistoryAccountIdentity,
      [null, null, true],
      documentId,
    );
    const value = observed.value;
    if (!isRecord(value)) throw new Error("hh_read_failed");
    if (
      allowEmpty &&
      value.accountKey === null &&
      value.emptyHistoryPage === true
    ) {
      return { value: null, documentId: observed.documentId, empty: true };
    }
    if (typeof value.accountKey !== "string" || !value.accountKey) {
      const safe = new Set([
        "history_target_mismatch",
        "unsupported_history_page",
        "account_identity_unverified",
        "history_identity_missing",
        "history_ambiguous",
        "account_changed",
      ]);
      throw new Error(
        typeof value.reasonCode === "string" && safe.has(value.reasonCode)
          ? value.reasonCode
          : "hh_read_failed",
      );
    }
    return {
      value: value.accountKey,
      documentId: observed.documentId,
      empty: false,
    };
  }
  async function loaded(
    tabId: number,
    expectedUrl: string,
    job?: CompanionJob,
    previousUrl?: string,
  ) {
    const deadline = Math.min(
      Date.now() + 20000,
      job ? Date.parse(job.expiresAt) : Infinity,
    );
    while (Date.now() < deadline) {
      if (job && Date.parse(job.expiresAt) <= Date.now()) {
        throw new Error("lease_expired");
      }
      const tab = requireRunnableTab(await chromeApi.tabs.get(tabId));
      if (Date.now() >= deadline) break;
      // Tabs.url is the last committed document. A newly created tab or an
      // owned navigation can still report it as complete while pendingUrl
      // points to the requested resource. Wait without reading that document.
      const expected = sameReadTarget(tab.url, expectedUrl);
      const previous =
        previousUrl !== undefined && sameReadTarget(tab.url, previousUrl);
      const initialBlank =
        previousUrl === undefined &&
        (tab.url === undefined || tab.url === "" || tab.url === "about:blank");
      if (
        (hasPendingNavigation(tab) &&
          !sameReadTarget(tab.pendingUrl, expectedUrl)) ||
        (!expected && !previous && !initialBlank)
      ) {
        throw new Error("unexpected_hh_navigation");
      }
      if (tab.status === "complete" && committedReadTarget(tab, expectedUrl)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      job && Date.parse(job.expiresAt) <= Date.now()
        ? "lease_expired"
        : "hh_page_timeout",
    );
  }
  async function withOwnedTab<Result>(
    initialUrl: string,
    run: (
      tabId: number,
      navigate: (url: string) => Promise<void>,
    ) => Promise<Result>,
  ): Promise<Result> {
    const tab = await chromeApi.tabs.create({ url: initialUrl, active: false });
    if (typeof tab.id !== "number" || !Number.isInteger(tab.id)) {
      throw new Error("hh_read_failed");
    }
    const tabId = tab.id;
    let expected = initialUrl;
    try {
      // Owned background tabs remain inactive, but should not be evicted by
      // memory saver midway through a bounded job. User tabs remain untouched.
      await chromeApi.tabs.update?.(tabId, { autoDiscardable: false });
      return await run(tabId, async (url: string) => {
        const current = requireRunnableTab(await chromeApi.tabs.get(tabId));
        // A user-navigated tab is no longer ours to steer or close.
        if (!committedReadTarget(current, expected)) {
          throw new Error("unexpected_hh_navigation");
        }
        expected = url;
        await chromeApi.tabs.update(tabId, { url });
      });
    } finally {
      const current = await chromeApi.tabs.get(tabId).catch(() => null);
      if (current && committedReadTarget(current, expected)) {
        await chromeApi.tabs.remove(tabId).catch(() => {});
      }
    }
  }
  async function identity(): Promise<string | null> {
    if (!chromeApi.tabs?.query || !chromeApi.scripting?.executeScript) {
      return null;
    }
    try {
      const tabs = await chromeApi.tabs.query({
        url: ["https://hh.ru/*", "https://*.hh.ru/*"],
      });
      const identities = new Set<string>();
      // Conflicting open sessions stop work; never guess which account was meant.
      if (tabs.length > 10) return null;
      for (const tab of tabs) {
        if (
          typeof tab.id !== "number" ||
          !Number.isInteger(tab.id) ||
          tab.status !== "complete"
        ) {
          continue;
        }
        const observed = await inject(
          tab.id,
          readVerifiedAccountIdentity,
          [],
        ).catch(() => null);
        if (typeof observed?.value === "string" && observed.value) {
          identities.add(observed.value);
        }
      }
      if (identities.size > 1) return null;
      if (identities.size === 1) return [...identities][0];
      return await withOwnedTab(HH + "/", async (tabId) => {
        await loaded(tabId, HH + "/");
        return (
          (await inject(tabId, readVerifiedAccountIdentity, [])).value ?? null
        );
      });
    } catch {
      return null;
    }
  }
  async function readJob(job: CompanionJob): Promise<JobResult> {
    if (Date.parse(job.expiresAt) <= Date.now()) {
      throw new Error("lease_expired");
    }
    const p = job.payload;
    if (
      p.kind === "read_hh_correspondence" &&
      (!validId(p.historyJobId) ||
        Object.keys(p).length !== 3 ||
        !Array.isArray(p.targets) ||
        !p.targets.length ||
        p.targets.length > 20 ||
        p.targets.some(
          (t) =>
            !isRecord(t) ||
            Object.keys(t).length !== 3 ||
            ![t.negotiationId, t.vacancyId, t.resumeInternalId].every(
              (v) => typeof v === "string" && /^[1-9]\d{0,30}$/u.test(v),
            ),
        ) ||
        new Set(p.targets.map((t) => t.negotiationId)).size !==
          p.targets.length)
    ) {
      throw new Error("invalid_read_payload");
    }
    if (
      p.kind === "read_hh_history" &&
      (Object.keys(p).sort().join() !== ["kind", "maxPages"].sort().join() ||
        !Number.isInteger(p.maxPages) ||
        p.maxPages < 3 ||
        p.maxPages > MAX_HISTORY_PAGES)
    ) {
      throw new Error("invalid_read_payload");
    }
    if (p.kind === "apply_vacancy" || p.kind === "publish_resume_variant") {
      throw new Error("invalid_read_payload");
    }
    if (p.kind === "read_application_outcomes") {
      const keys = [
        "applicationId",
        "expectedVersion",
        "vacancyId",
        "resumeId",
        "resumeInternalId",
        "negotiationId",
        "claimJobId",
        "historyJobId",
      ];
      if (
        Object.keys(p).sort().join() !==
          ["kind", "targets", "maxPages"].sort().join() ||
        !Number.isInteger(p.maxPages) ||
        p.maxPages < 1 ||
        p.maxPages > MAX_HISTORY_PAGES ||
        !Array.isArray(p.targets) ||
        p.targets.length < 1 ||
        p.targets.length > 20 ||
        p.targets.some(
          (t) =>
            !t ||
            Object.keys(t).sort().join() !== [...keys].sort().join() ||
            !(
              [
                "applicationId",
                "resumeId",
                "claimJobId",
                "historyJobId",
              ] as const
            ).every((k) => validId(t[k])) ||
            !(
              ["vacancyId", "resumeInternalId", "negotiationId"] as const
            ).every(
              (k) => typeof t[k] === "string" && /^[1-9]\d{0,30}$/u.test(t[k]),
            ) ||
            !Number.isSafeInteger(t.expectedVersion) ||
            t.expectedVersion < 0,
        ) ||
        new Set(p.targets.map((t) => t.applicationId)).size !==
          p.targets.length ||
        new Set(p.targets.map((t) => t.negotiationId)).size !== p.targets.length
      ) {
        throw new Error("invalid_read_payload");
      }
    }
    const searchUrl = (page: number) => {
      if (p.kind !== "discover_search") throw new Error("invalid_read_payload");
      const url = new URL(`${HH}/search/vacancy`);
      url.searchParams.set("text", p.text);
      for (const [key, value] of p.searchParameters ?? []) {
        url.searchParams.append(key, value);
      }
      url.searchParams.set("page", String(page));
      return url.href;
    };
    if (
      p.kind === "discover_search" &&
      (!validId(p.savedSearchId) ||
        typeof p.text !== "string" ||
        p.text.length > 1000 ||
        !Number.isInteger(p.maxPages) ||
        p.maxPages < 1 ||
        p.maxPages > 20 ||
        (p.cursor !== undefined &&
          (!validId(p.rootJobId) ||
            !isRecord(p.cursor) ||
            Object.keys(p.cursor).sort().join() !== "offset,page" ||
            !Number.isInteger(p.cursor.page) ||
            p.cursor.page < 0 ||
            p.cursor.page >= p.maxPages ||
            !Number.isInteger(p.cursor.offset) ||
            p.cursor.offset < 0 ||
            p.cursor.offset > 99)) ||
        (p.searchParameters !== undefined &&
          (!Array.isArray(p.searchParameters) ||
            p.searchParameters.length > 40 ||
            !p.searchParameters.every(
              (pair) =>
                Array.isArray(pair) &&
                pair.length === 2 &&
                [
                  "area",
                  "experience",
                  "employment",
                  "schedule",
                  "professional_role",
                  "salary",
                  "currency",
                  "only_with_salary",
                  "search_field",
                  "order_by",
                  "period",
                  "label",
                ].includes(pair[0]) &&
                typeof pair[1] === "string" &&
                /^[a-zA-Z0-9_-]{1,80}$/u.test(pair[1]),
            ))))
    ) {
      throw new Error("invalid_read_payload");
    }
    if (
      p.kind === "verify_vacancy" &&
      (!vacancyId(p.vacancyId) ||
        !validId(p.applicationId) ||
        !Number.isSafeInteger(p.expectedVersion) ||
        p.expectedVersion < 0)
    ) {
      throw new Error("invalid_read_payload");
    }
    if (
      p.kind === "read_profile" &&
      (!Array.isArray(p.includeResumeIds) ||
        p.includeResumeIds.length > 20 ||
        !p.includeResumeIds.every(validId) ||
        typeof p.includeProfileText !== "boolean")
    ) {
      throw new Error("invalid_read_payload");
    }
    if (
      p.kind === "read_resume_artifact" &&
      (!validId(p.resumeId) ||
        p.resumeId.length < 4 ||
        typeof p.internalId !== "string" ||
        !/^[1-9]\d{0,30}$/u.test(p.internalId))
    ) {
      throw new Error("invalid_read_payload");
    }
    if (
      p.kind === "reconcile_history" &&
      (!vacancyId(p.vacancyId) ||
        !validId(p.resumeId) ||
        !validId(p.originalJobId) ||
        !validId(p.applicationId))
    ) {
      throw new Error("invalid_read_payload");
    }
    let initialUrl: string;
    switch (p.kind) {
      case "read_hh_history":
      case "read_hh_correspondence":
        initialUrl = `${HH}/applicant/negotiations?filter=active&page=0`;
        break;
      case "read_application_outcomes":
        initialUrl = `${HH}/resume/${p.targets[0].resumeId}`;
        break;
      case "discover_search":
        initialUrl = searchUrl(p.cursor?.page ?? 0);
        break;
      case "verify_vacancy":
        initialUrl = `${HH}/vacancy/${p.vacancyId}`;
        break;
      case "read_profile":
        initialUrl = p.includeResumeIds.length
          ? `${HH}/resume/${p.includeResumeIds[0]}`
          : HH + "/";
        break;
      default:
        initialUrl = `${HH}/resume/${p.resumeId}`;
    }
    return withOwnedTab(initialUrl, async (tabId, navigate) => {
      let currentUrl = initialUrl;
      const freshSessionIdentity = () =>
        withOwnedTab(HH + "/", async (identityTab) => {
          await loaded(identityTab, HH + "/", job);
          return (await inject(identityTab, readVerifiedAccountIdentity, []))
            .value;
        });
      async function read<Result>(
        url: string,
        operation: string | undefined,
        run: (
          documentId?: string,
          sessionVerifiedEmpty?: boolean,
        ) => Promise<Result>,
      ): Promise<Result> {
        if (Date.parse(job.expiresAt) <= Date.now()) {
          throw new Error("lease_expired");
        }
        let previousUrl: string | undefined;
        if (url !== currentUrl) {
          previousUrl = currentUrl;
          await navigate(url);
          currentUrl = url;
        }
        await loaded(tabId, url, job, previousUrl);
        let sessionVerifiedEmpty = false;
        let before = await inject(tabId, readVerifiedAccountIdentity, []);
        if (!before.value && operation === "history") {
          const history = await historyIdentity(
            tabId,
            before.documentId,
            p.kind === "read_hh_history" || p.kind === "read_hh_correspondence",
          );
          sessionVerifiedEmpty = history.empty;
          before = {
            value: history.empty ? await freshSessionIdentity() : history.value,
            documentId: history.documentId,
          };
        }
        if (!accountMatches(job.hhAccountKey, before.value)) {
          throw new Error("account_identity_unverified");
        }
        const result = await run(before.documentId, sessionVerifiedEmpty);
        let after = await inject(
          tabId,
          readVerifiedAccountIdentity,
          [],
          before.documentId,
        );
        if (sessionVerifiedEmpty) {
          const empty = await historyIdentity(tabId, before.documentId, true);
          if (!empty.empty) throw new Error("incomplete_history_page");
          const currentAccount = await freshSessionIdentity();
          const unchanged = await historyIdentity(
            tabId,
            before.documentId,
            true,
          );
          if (!unchanged.empty) throw new Error("incomplete_history_page");
          after = { value: currentAccount, documentId: unchanged.documentId };
        } else if (!after.value && operation === "history") {
          after = await historyIdentity(tabId, before.documentId);
        }
        if (!accountMatches(job.hhAccountKey, after.value)) {
          throw new Error("account_changed");
        }
        if (
          !committedReadTarget(
            requireRunnableTab(await chromeApi.tabs.get(tabId)),
            url,
          )
        ) {
          throw new Error("unexpected_hh_navigation");
        }
        if (Date.parse(job.expiresAt) <= Date.now()) {
          throw new Error("lease_expired");
        }
        return result;
      }
      const pageRead = (url: string, request: PageEvidenceRequest) =>
        read(
          url,
          request.operation,
          async (documentId) =>
            (await inject(tabId, readPageEvidence, [request], documentId))
              .value,
        );
      async function resumeRead(url: string, resumeId: string) {
        const result = await pageRead(url, { operation: "resume", resumeId });
        if (!("internalId" in result)) {
          throw new Error("resume_identity_mismatch");
        }
        return result;
      }
      async function vacancyRead(url: string, vacancyId: string) {
        const result = await pageRead(url, { operation: "vacancy", vacancyId });
        if (!("text" in result)) throw new Error("vacancy_text_unavailable");
        return result;
      }
      async function historyRead(
        url: string,
        filter: HistoryFilter,
        page: number,
      ) {
        const result = await pageRead(url, {
          operation: "history",
          filter,
          page,
        });
        if (!("observations" in result)) {
          throw new Error("unsupported_history_page");
        }
        return result;
      }
      if (p.kind === "verify_vacancy") {
        return {
          kind: p.kind,
          ...(await vacancyRead(initialUrl, p.vacancyId)),
        };
      }
      if (p.kind === "read_resume_artifact") {
        return {
          kind: p.kind,
          artifact: await read(
            initialUrl,
            undefined,
            async (documentId) =>
              (
                await inject(
                  tabId,
                  readPublicationResumeArtifacts,
                  [
                    {
                      resumeId: p.resumeId,
                      internalId: p.internalId,
                      hhAccountKey: job.hhAccountKey,
                    },
                  ],
                  documentId,
                )
              ).value,
          ),
        };
      }
      if (p.kind === "discover_search") {
        const vacancies: SearchVacancy[] = [];
        const seen = new Set<string>();
        let pages = 0;
        let complete = false;
        let length = 0;
        let stop = false;
        let nextCursor: { page: number; offset: number } | null = null;
        const start = p.cursor ?? { page: 0, offset: 0 };
        for (let page = start.page; page < p.maxPages; page++) {
          const url = searchUrl(page);
          const data = await pageRead(url, {
            operation: "search",
            page,
            expectedUrl: url,
          });
          if (!("vacancies" in data)) throw new Error("unsupported_hh_page");
          pages++;
          const offset = page === start.page ? start.offset : 0;
          if (offset > data.vacancies.length) {
            throw new Error("unsupported_hh_page");
          }
          const remaining = data.vacancies.slice(offset);
          const candidateIds = remaining
            .filter(
              (row) => vacancyId(row.vacancyId) && !seen.has(row.vacancyId),
            )
            .slice(0, 20)
            .map((row) => row.vacancyId);
          let shared: SearchVacancy[] = [];
          if (transport?.publicDetails && candidateIds.length) {
            try {
              const result = await transport.publicDetails(job, [
                ...new Set(candidateIds),
              ]);
              if (
                isRecord(result) &&
                Array.isArray(result.vacancies) &&
                result.vacancies.length <= 20
              ) {
                shared = result.vacancies.filter(
                  (row: unknown): row is SearchVacancy =>
                    isRecord(row) &&
                    typeof row.vacancyId === "string" &&
                    candidateIds.includes(row.vacancyId) &&
                    typeof row.title === "string" &&
                    !!row.title.trim() &&
                    row.title.length <= 1000 &&
                    (row.company === null ||
                      (typeof row.company === "string" &&
                        row.company.length <= 1000)) &&
                    typeof row.text === "string" &&
                    !!row.text.trim() &&
                    row.text.length <= 250000,
                );
              }
            } catch {
              /* Older server or unavailable cache: own bounded detail read. */
            }
          }
          for (const [index, row] of remaining.entries()) {
            if (seen.has(row.vacancyId)) continue;
            if (
              vacancies.length >= 20 ||
              Date.parse(job.expiresAt) - Date.now() < 25000
            ) {
              stop = true;
              nextCursor = { page, offset: offset + index };
              break;
            }
            const cached = shared.find(
              (value) => value.vacancyId === row.vacancyId,
            );
            const detail =
              cached ??
              (await vacancyRead(
                `${HH}/vacancy/${row.vacancyId}`,
                row.vacancyId,
              ));
            if (length + detail.text.length > 400000) {
              stop = true;
              nextCursor = { page, offset: offset + index };
              break;
            }
            vacancies.push({
              ...detail,
              company: cached ? cached.company : row.company,
            });
            seen.add(row.vacancyId);
            length += detail.text.length;
          }
          if (stop) break;
          if (!data.hasNext) {
            complete = true;
            break;
          }
          if (vacancies.length >= 20) {
            nextCursor =
              page + 1 < p.maxPages ? { page: page + 1, offset: 0 } : null;
            break;
          }
        }
        return {
          kind: p.kind,
          savedSearchId: p.savedSearchId,
          pages,
          complete,
          vacancies,
          nextCursor,
        };
      }
      if (p.kind === "read_profile") {
        const resumes: ResumeEvidence[] = [];
        for (const resumeId of new Set(p.includeResumeIds)) {
          resumes.push(await resumeRead(`${HH}/resume/${resumeId}`, resumeId));
        }
        if (!resumes.length) await read(HH + "/", undefined, async () => null);
        return { kind: p.kind, resumes };
      }
      if (p.kind === "read_hh_history" || p.kind === "read_hh_correspondence") {
        const observations = new Map<string, FullHistoryObservation>();
        const chatReferences = new Map<
          string,
          {
            negotiationId: string;
            vacancyId: string;
            resumeInternalId: string;
            chatId: string | null;
            expectedMessages: number | null;
          }
        >();
        let pages = 0;
        const observedAt = new Date().toISOString();
        const result = (complete: boolean): JobResult => ({
          kind: "read_hh_history",
          readerVersion: "hh-full-history-v1",
          observedAt: new Date().toISOString(),
          pages,
          complete,
          observations: [...observations.values()],
        });
        for (const filter of ["active", "archived", "deleted"] as const) {
          let expectedPages: number | undefined;
          for (let page = 0; ; page++) {
            if (
              pages >=
              (p.kind === "read_hh_history" ? p.maxPages : MAX_HISTORY_PAGES)
            ) {
              if (p.kind === "read_hh_correspondence") {
                throw new Error("incomplete_history_page");
              }
              return result(false);
            }
            const data = await read(
              `${HH}/applicant/negotiations?filter=${filter}&page=${page}`,
              "history",
              async (documentId, sessionVerifiedEmpty) =>
                (
                  await inject(
                    tabId,
                    readFullHistoryPage,
                    [
                      {
                        filter,
                        page,
                        hhAccountKey: job.hhAccountKey,
                        observedAt,
                        sessionVerifiedEmpty,
                        includeChatReferences:
                          p.kind === "read_hh_correspondence",
                      },
                    ],
                    documentId,
                  )
                ).value,
            );
            pages++;
            for (const ref of data.chatReferences ?? []) {
              chatReferences.set(ref.negotiationId, ref);
            }
            expectedPages ??= Math.max(1, data.pageCount);
            if (expectedPages !== Math.max(1, data.pageCount)) {
              throw new Error("incomplete_history_page");
            }
            for (const row of data.observations) {
              if (observations.has(row.negotiationId)) {
                throw new Error("history_ambiguous");
              }
              observations.set(row.negotiationId, row);
              if (observations.size > 10000) {
                throw new Error("incomplete_history_page");
              }
            }
            if (page + 1 === expectedPages && !data.hasNext) break;
            if (page + 1 >= expectedPages || !data.hasNext) {
              throw new Error("incomplete_history_page");
            }
          }
        }
        if (p.kind === "read_hh_correspondence") {
          const threads: CapturedConversation[] = [];
          let totalSize = 0;
          for (const target of p.targets) {
            const ref = chatReferences.get(target.negotiationId);
            if (!ref) {
              threads.push({
                ...target,
                chatId: null,
                snapshot: null,
                reason: "history_not_confirmed",
              });
              continue;
            }
            if (
              ref.vacancyId !== target.vacancyId ||
              ref.resumeInternalId !== target.resumeInternalId
            ) {
              throw new Error("history_ambiguous");
            }
            if (!ref.chatId) {
              threads.push({
                ...target,
                chatId: null,
                snapshot: null,
                reason: "chat_missing",
              });
              continue;
            }
            if (totalSize >= 1780000) {
              threads.push({
                ...target,
                chatId: ref.chatId,
                snapshot: null,
                reason: "snapshot_limit",
              });
              continue;
            }
            const url = `https://hh.ru/chat/${ref.chatId}`;
            if (
              !accountMatches(job.hhAccountKey, await freshSessionIdentity())
            ) {
              throw new Error("account_changed");
            }
            let snapshot: string | null = null;
            try {
              snapshot = await withOwnedTab(url, async (chatTab) => {
                await loaded(chatTab, url, job);
                // HH embeds Chatik. Read only same-chat HH frames inside this
                // owned tab; unrelated/ad frames return null without inspection.
                let snapshots: string[] = [];
                try {
                  const results = await chromeApi.scripting.executeScript({
                    target: { tabId: chatTab, allFrames: true },
                    world: "ISOLATED",
                    func: readChatSnapshot,
                    args: [
                      ref.chatId!,
                      ref.expectedMessages,
                      true,
                      job.hhAccountKey.match(
                        /^hh-applicant-([1-9]\d{0,30})$/u,
                      )?.[1] ?? null,
                    ],
                  });
                  snapshots = results
                    .filter(
                      (r) =>
                        !("error" in r && r.error) &&
                        Number.isSafeInteger(r.frameId) &&
                        typeof r.result === "string",
                    )
                    .map((r) => r.result as string);
                } catch {
                  /* A denied embedded frame does not hide the top-frame result. */
                }
                if (!snapshots.length) {
                  const result = await inject(chatTab, readChatSnapshot, [
                    ref.chatId!,
                    ref.expectedMessages,
                    false,
                    job.hhAccountKey.match(
                      /^hh-applicant-([1-9]\d{0,30})$/u,
                    )?.[1] ?? null,
                  ]);
                  if (result.value) snapshots.push(result.value);
                }
                if (
                  !committedReadTarget(
                    requireRunnableTab(await chromeApi.tabs.get(chatTab)),
                    url,
                  )
                ) {
                  throw new Error("unexpected_hh_navigation");
                }
                return (
                  snapshots.find(
                    (s) =>
                      s.includes('data-read-format="hh-chat-api-v1"') &&
                      s.includes('data-api-has-more="false"') &&
                      s.includes('data-read-truncated="false"'),
                  ) ??
                  snapshots.find((s) =>
                    s.includes('data-read-format="hh-chat-api-v1"'),
                  ) ??
                  snapshots.find((s) =>
                    s.includes(`data-captured-chat-id="${ref.chatId}"`),
                  ) ??
                  snapshots[0] ??
                  null
                );
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (
                ![
                  "hh_read_failed",
                  "hh_page_timeout",
                  "unexpected_hh_navigation",
                  "hh_tab_suspended",
                ].includes(reason)
              ) {
                throw error;
              }
            }
            if (
              !accountMatches(job.hhAccountKey, await freshSessionIdentity())
            ) {
              throw new Error("account_changed");
            }
            if (Date.parse(job.expiresAt) <= Date.now()) {
              throw new Error("lease_expired");
            }
            if (snapshot) totalSize += snapshot.length;
            threads.push({
              ...target,
              chatId: ref.chatId,
              snapshot,
              reason: snapshot ? null : "chat_not_loaded",
            });
          }
          return {
            kind: "read_hh_correspondence",
            readerVersion: "hh-chat-dom-v1",
            observedAt: new Date().toISOString(),
            complete: true,
            threads,
          };
        }
        return result(true);
      }
      if (p.kind === "read_application_outcomes") {
        const resumes = new Map<string, string>();
        const observations = new Map<string, OutcomeObservation>();
        for (const target of p.targets) {
          if (!resumes.has(target.resumeId)) {
            resumes.set(
              target.resumeId,
              (
                await resumeRead(
                  `${HH}/resume/${target.resumeId}`,
                  target.resumeId,
                )
              ).internalId,
            );
          }
          if (resumes.get(target.resumeId) !== target.resumeInternalId) {
            throw new Error("resume_identity_mismatch");
          }
        }
        let pages = 0;
        const result = (complete: boolean): JobResult => ({
          kind: "read_application_outcomes",
          readerVersion: "hh-application-outcomes-v1",
          observedAt: new Date().toISOString(),
          pages,
          complete,
          observations: [...observations.values()],
        });
        for (const filter of ["active", "archived", "deleted"] as const) {
          let expectedPages;
          for (let page = 0; ; page++) {
            if (pages >= p.maxPages) return result(false);
            const data = await read(
              `${HH}/applicant/negotiations?filter=${filter}&page=${page}`,
              "history",
              async (documentId) =>
                (
                  await inject(
                    tabId,
                    readApplicationOutcomesPage,
                    [
                      {
                        filter,
                        page,
                        targets: p.targets,
                        hhAccountKey: job.hhAccountKey,
                      },
                    ],
                    documentId,
                  )
                ).value,
            );
            pages++;
            expectedPages ??= Math.max(1, data.pageCount);
            if (expectedPages !== Math.max(1, data.pageCount)) {
              throw new Error("incomplete_history_page");
            }
            for (const row of data.observations) {
              if (observations.has(row.negotiationId)) {
                throw new Error("history_ambiguous");
              }
              observations.set(row.negotiationId, row);
            }
            if (page + 1 === expectedPages && !data.hasNext) break;
            if (page + 1 >= expectedPages || !data.hasNext) {
              throw new Error("incomplete_history_page");
            }
          }
        }
        return result(true);
      }
      const resume = await resumeRead(initialUrl, p.resumeId);
      let pages = 0;
      const exact = new Map<string, HistoryObservation>();
      const observed = new Map<string, string>();
      for (const filter of ["active", "archived", "deleted"] as const) {
        let expectedPages;
        for (let page = 0; ; page++) {
          if (pages >= MAX_HISTORY_PAGES) {
            throw new Error("incomplete_history_page");
          }
          const data = await historyRead(
            `${HH}/applicant/negotiations?filter=${filter}&page=${page}`,
            filter,
            page,
          );
          pages++;
          expectedPages ??= Math.max(1, data.pageCount);
          if (expectedPages !== Math.max(1, data.pageCount)) {
            throw new Error("incomplete_history_page");
          }
          for (const row of data.observations) {
            const identity = `${row.vacancyId}:${row.resumeInternalId}:${row.initiatedByApplicant}`;
            if (
              observed.has(row.negotiationId) &&
              observed.get(row.negotiationId) !== identity
            ) {
              throw new Error("history_identity_missing");
            }
            observed.set(row.negotiationId, identity);
            if (
              row.vacancyId === p.vacancyId &&
              row.resumeInternalId === resume.internalId &&
              row.initiatedByApplicant
            ) {
              exact.set(row.negotiationId, row);
            }
          }
          if (page + 1 === expectedPages && !data.hasNext) break;
          if (page + 1 >= expectedPages || !data.hasNext) {
            throw new Error("incomplete_history_page");
          }
        }
      }
      if (exact.size !== 1) {
        throw new Error(
          exact.size ? "history_ambiguous" : "history_not_confirmed",
        );
      }
      return {
        kind: p.kind,
        originalJobId: p.originalJobId,
        vacancyId: p.vacancyId,
        resumeId: p.resumeId,
        resumeInternalId: resume.internalId,
        negotiationId: [...exact.keys()][0],
        pages,
        complete: true,
      };
    });
  }
  return {
    identity,
    async execute(job: CompanionJob) {
      if (running) return blockedReceipt(job, "executor_busy");
      running = true;
      try {
        const previous = await checkpoints?.load();
        if (
          previous &&
          (previous.jobId !== job.jobId ||
            ["authorized", "reconciling"].includes(previous.phase))
        ) {
          return blockedReceipt(job, "reconciliation_required", "unknown");
        }
        return await executeJob(job, { identity, readJob });
      } finally {
        running = false;
      }
    },
  };
}
