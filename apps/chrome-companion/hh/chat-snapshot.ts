/** Read-only DOM capture from a chat selected by an owned negotiation row.
 * No cookies, headers, scripts, hidden nodes, inputs or executable HTML leave
 * this document. The server treats unknown author/format as unverified.
 */
export async function readChatSnapshot(
  chatId: string,
  expectedMessages: number | null = null,
  embedded = false,
  expectedApplicantId: string | null = null,
): Promise<string | null> {
  const url = new URL(globalThis.location.href);
  // HH can initialize its Chatik root iframe through its integration bridge.
  // This branch is used only inside the executor's owned tab. API requests
  // remain pinned to chatId; a root iframe never falls back to DOM contents.
  const embeddedRoot =
    embedded && url.hostname === "chatik.hh.ru" && url.pathname === "/";
  if (
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    (url.pathname !== `/chat/${chatId}` && !embeddedRoot) ||
    [...url.searchParams].some(([key, value]) => {
      if (url.searchParams.getAll(key).length !== 1) return true;
      // HH's own integration appends these two parameters to its Chatik
      // iframe. They select the embedded layout; reading this frame neither
      // requests microphone access nor executes any chat action.
      if (embedded && url.hostname === "chatik.hh.ru") {
        if (key === "dest") return value !== "iframe";
        if (key === "microphone") return !["true", "false"].includes(value);
      }
      return (
        !["without_list", "platform", "theme"].includes(key) ||
        !/^[A-Za-z0-9_-]{1,32}$/u.test(value)
      );
    }) ||
    !/^[1-9]\d{0,30}$/u.test(chatId)
  ) {
    if (embedded) return null;
    throw new Error("history_target_mismatch");
  }
  const escape = (value: string): string =>
    value.replace(
      /[&<>]/gu,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? "",
    );
  // Fixed, read-only resource for the chat obtained from an owned HH topic.
  // Never copy cookies, headers or a complete initial-state object to the BFF.
  let apiStatus: number | null = null;
  let apiFailure = "fetch_unavailable";
  if (typeof globalThis.fetch === "function") {
    try {
      const response = await globalThis.fetch(
        `https://chatik.hh.ru/chatik/api/chat_data?chatId=${chatId}`,
        {
          method: "GET",
          credentials: "include",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      apiStatus = response.status;
      if (
        response.ok &&
        response.headers.get("content-type")?.includes("json")
      ) {
        const raw = await response.text();
        if (raw.length <= 1000000) {
          const value: unknown = JSON.parse(raw);
          const record = (item: unknown): Record<string, unknown> =>
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as Record<string, unknown>)
              : {};
          const envelope = record(value);
          const chat = record(envelope.chat);
          const responseChatId = chat.id ?? chat.chatId ?? envelope.chatId;
          if (responseChatId == null || String(responseChatId) !== chatId) {
            throw new Error("history_target_mismatch");
          }
          const messages = record(chat.messages);
          let apiPages = 1;
          let paginationState = "not_needed";
          let scrollerFound = false;
          const observedRequests: Array<{ path: string; queryKeys: string[] }> =
            [];
          // Older-page URLs must come from HH resources or a request made by
          // the rendered history scroller. Never guess a cursor or call an
          // action endpoint. All requests remain GETs for this owned chat.
          const initialUrl = `https://chatik.hh.ru/chatik/api/chat_data?chatId=${chatId}`;
          const visited = new Set([initialUrl]);
          function messagePageUrl(input: unknown): string | null {
            if (typeof input !== "string") return null;
            try {
              const next = new URL(input, "https://chatik.hh.ru");
              if (
                next.origin !== "https://chatik.hh.ru" ||
                next.username ||
                next.password ||
                next.hash ||
                !/^\/chatik\/api\/(?:chat_data|messages|chat_messages|get_messages)$/u.test(
                  next.pathname,
                ) ||
                next.searchParams.getAll("chatId").length !== 1 ||
                next.searchParams.get("chatId") !== chatId
              ) {
                return null;
              }
              for (const [key, parameter] of next.searchParams) {
                if (
                  ![
                    "chatId",
                    "applicantId",
                    "do_not_track_session_events",
                    "fromMessageId",
                    "toMessageId",
                    "beforeMessageId",
                    "afterMessageId",
                    "lastMessageId",
                    "firstMessageId",
                    "olderThan",
                    "newerThan",
                    "limit",
                    "count",
                    "offset",
                    "page",
                    "from",
                    "to",
                    "before",
                    "after",
                    "cursor",
                    "direction",
                    "size",
                    "pageSize",
                    "perPage",
                    "order",
                    "sort",
                  ].includes(key) ||
                  !/^[A-Za-z_]{1,40}$/u.test(key) ||
                  /token|auth|secret|password|key|xsrf|url|redirect/iu.test(
                    key,
                  ) ||
                  !/^[A-Za-z0-9_.:+=-]{1,160}$/u.test(parameter) ||
                  next.searchParams.getAll(key).length !== 1
                ) {
                  return null;
                }
                if (
                  key === "applicantId" &&
                  (!expectedApplicantId || parameter !== expectedApplicantId)
                ) {
                  return null;
                }
                if (
                  key === "do_not_track_session_events" &&
                  !["true", "false", "0", "1"].includes(parameter)
                ) {
                  return null;
                }
              }
              if (
                ![...next.searchParams.keys()].some(
                  (key) =>
                    ![
                      "chatId",
                      "applicantId",
                      "do_not_track_session_events",
                    ].includes(key),
                )
              ) {
                return null;
              }
              return visited.has(next.href) ? null : next.href;
            } catch {
              return null;
            }
          }
          function resourceUrls(input: unknown, depth = 0): string[] {
            if (depth > 5) return [];
            const node = record(input);
            const urls: string[] = [];
            for (const [key, item] of Object.entries(node)) {
              if (
                /resources|paging|pagination|chat|messages|next|previous|older|history|more|url|href|uri/iu.test(
                  key,
                )
              ) {
                const next = messagePageUrl(item);
                if (next) urls.push(next);
                else if (item && typeof item === "object") {
                  urls.push(...resourceUrls(item, depth + 1));
                }
              }
            }
            return urls;
          }
          async function scrolledPageUrl(): Promise<string | null> {
            // HH also renders the conversation on regional /chat/:id pages.
            // The document URL was validated above and every observed request
            // still has to match the exact owned chat and read-only endpoint.
            let scroller: HTMLElement | null = null;
            const normalize = (text: string) =>
              text
                .replace(/<[^>]*>/gu, " ")
                .replace(/\s+/gu, " ")
                .trim();
            const knownTexts = [
              ...new Set(
                (Array.isArray(messages.items) ? messages.items : [])
                  .map((item) => record(item).text)
                  .filter((text): text is string => typeof text === "string")
                  .map(normalize)
                  .filter((text) => text.length >= 4)
                  .map((text) => text.slice(0, 1000)),
              ),
            ];
            for (
              let renderAttempt = 0;
              renderAttempt < 12 && !scroller;
              renderAttempt++
            ) {
              const candidates = [
                ...document.querySelectorAll(
                  '[data-qa*="message" i],[class*="message" i],[data-message-id]',
                ),
              ];
              const containers = new Set<HTMLElement>();
              for (const candidate of candidates) {
                let parent = candidate.parentElement;
                while (parent) {
                  const style = getComputedStyle(parent);
                  if (
                    parent.scrollHeight > parent.clientHeight + 10 &&
                    /auto|scroll/u.test(style.overflowY)
                  ) {
                    containers.add(parent);
                    break;
                  }
                  parent = parent.parentElement;
                }
              }
              // The left conversation list also has message previews. Require
              // the history pane to contain known text from this pinned API
              // conversation; never pick the first generic "message" element.
              const ranked = [...containers]
                .map((element) => {
                  const content = normalize(element.textContent ?? "");
                  return {
                    element,
                    score: knownTexts.filter((text) => content.includes(text))
                      .length,
                  };
                })
                .filter(
                  (item) =>
                    item.score >= Math.min(2, knownTexts.length) &&
                    item.score > 0,
                )
                .sort((a, b) => {
                  if (a.score !== b.score) {
                    return b.score - a.score;
                  }
                  if (a.element.contains(b.element)) {
                    return 1;
                  }
                  if (b.element.contains(a.element)) {
                    return -1;
                  }
                  return 0;
                });
              const first = ranked[0];
              const second = ranked[1];
              if (
                first &&
                (!second ||
                  first.score > second.score ||
                  second.element.contains(first.element))
              ) {
                scroller = first.element;
              }
              if (!scroller) {
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
              }
            }
            if (!scroller) {
              paginationState = "history_scroller_missing";
              return null;
            }
            scrollerFound = true;
            const reverse =
              getComputedStyle(scroller).flexDirection === "column-reverse";
            const oldest = reverse
              ? -(scroller.scrollHeight - scroller.clientHeight)
              : 0;
            scroller.scrollTop = oldest + (reverse ? -1 : 1);
            scroller.scrollTop = oldest;
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
            for (let attempt = 0; attempt < 12; attempt++) {
              const entries = performance.getEntriesByType("resource");
              for (let index = entries.length - 1; index >= 0; index--) {
                const entry = entries[index];
                if (
                  !("initiatorType" in entry) ||
                  !["fetch", "xmlhttprequest"].includes(
                    String(entry.initiatorType),
                  )
                ) {
                  continue;
                }
                // Structural diagnostics only: no query values, chat IDs,
                // message text, headers or credentials leave the document.
                try {
                  const observed = new URL(entry.name);
                  if (
                    observed.origin === "https://chatik.hh.ru" &&
                    /^\/chatik\/api\/[A-Za-z0-9_/-]{1,120}$/u.test(
                      observed.pathname,
                    ) &&
                    observedRequests.length < 12
                  ) {
                    const path = observed.pathname.replace(/\d+/gu, ":id");
                    const queryKeys = [...new Set(observed.searchParams.keys())]
                      .filter((key) => /^[A-Za-z_]{1,40}$/u.test(key))
                      .slice(0, 20);
                    if (
                      !observedRequests.some(
                        (item) =>
                          item.path === path &&
                          item.queryKeys.join() === queryKeys.join(),
                      )
                    ) {
                      observedRequests.push({ path, queryKeys });
                    }
                  }
                } catch {
                  /* A malformed resource name provides no evidence. */
                }
                const next = messagePageUrl(entries[index].name);
                if (next) return next;
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 250));
            }
            paginationState = "history_request_missing";
            return null;
          }
          let pageEvidence: unknown = value;
          let pageAttempts = 0;
          while (
            messages.hasMore === true &&
            Array.isArray(messages.items) &&
            apiPages < 10 &&
            pageAttempts++ < 12
          ) {
            paginationState = "page_not_available";
            try {
              const nextUrl =
                resourceUrls(pageEvidence)[0] ?? (await scrolledPageUrl());
              if (!nextUrl) break;
              visited.add(nextUrl);
              const nextResponse = await globalThis.fetch(nextUrl, {
                method: "GET",
                credentials: "include",
                redirect: "error",
                cache: "no-store",
                signal: AbortSignal.timeout(8000),
              });
              if (
                !nextResponse.ok ||
                !nextResponse.headers.get("content-type")?.includes("json")
              ) {
                paginationState = "page_response_unavailable";
                break;
              }
              const nextRaw = await nextResponse.text();
              if (nextRaw.length > 1000000) break;
              const nextData: unknown = JSON.parse(nextRaw);
              const nextObject = record(nextData);
              const nextChat = record(nextObject.chat);
              if (
                (nextChat.id != null && String(nextChat.id) !== chatId) ||
                (nextObject.chatId != null &&
                  String(nextObject.chatId) !== chatId)
              ) {
                break;
              }
              const nextMessages = record(
                nextChat.messages ?? nextObject.messages ?? nextData,
              );
              if (
                !Array.isArray(nextMessages.items) ||
                typeof nextMessages.hasMore !== "boolean"
              ) {
                break;
              }
              if (
                nextMessages.items.some((item) => {
                  const row = record(item);
                  return (
                    row.id == null ||
                    (row.chatId != null && String(row.chatId) !== chatId)
                  );
                })
              ) {
                break;
              }
              const merged = new Map(
                messages.items.map((item) => [String(record(item).id), item]),
              );
              const priorSize = merged.size;
              for (const item of nextMessages.items) {
                merged.set(String(record(item).id), item);
              }
              if (merged.size === priorSize && nextMessages.hasMore) {
                pageEvidence = nextData;
                continue;
              }
              messages.items = [...merged.values()];
              messages.hasMore = nextMessages.hasMore;
              apiPages++;
              paginationState = messages.hasMore ? "more_pages" : "complete";
              pageEvidence = nextData;
            } catch {
              paginationState = "page_read_failed";
              break;
            }
          }
          envelope.readDiagnostics = {
            paginationState,
            scrollerFound,
            observedRequests,
          };
          const fields = new Set([
            "readDiagnostics",
            "paginationState",
            "scrollerFound",
            "observedRequests",
            "path",
            "queryKeys",
            "chat",
            "resources",
            "currentParticipantId",
            "participantDisplay",
            "participantsIds",
            "buttons",
            "textButtons",
            "label",
            "params",
            "parameters",
            "action",
            "linkUrl",
            "result",
            "chatData",
            "chat_data",
            "message",
            "messageText",
            "senderType",
            "authorParticipantId",
            "chatParticipantId",
            "user",
            "messagesPage",
            "collection",
            "textHtml",
            "textSegments",
            "segments",
            "children",
            "isSelf",
            "direction",
            "uuid",
            "isLastPage",
            "totalPages",
            "lastPage",
            "nextPage",
            "hasNextPage",
            "hasPreviousPage",
            "from",
            "to",
            "creationDate",
            "chatId",
            "topicId",
            "id",
            "messageId",
            "messages",
            "items",
            "participants",
            "participant",
            "currentParticipant",
            "me",
            "sender",
            "author",
            "senderId",
            "authorId",
            "participantId",
            "fromId",
            "text",
            "html",
            "body",
            "content",
            "data",
            "value",
            "paragraphs",
            "links",
            "url",
            "href",
            "type",
            "role",
            "userType",
            "authorType",
            "participantType",
            "accountType",
            "isEmployer",
            "isApplicant",
            "isMine",
            "isOwn",
            "isMe",
            "userId",
            "createdAt",
            "creationTime",
            "created_at",
            "timestamp",
            "date",
            "pagination",
            "paging",
            "hasMore",
            "hasNext",
            "hasPrevious",
            "isLast",
            "isFirst",
            "total",
            "totalCount",
            "messageCount",
            "count",
            "limit",
            "offset",
            "page",
            "pageCount",
            "next",
            "previous",
          ]);
          let truncated = false;
          function project(
            input: unknown,
            itemsLimit: number,
            depth = 0,
          ): unknown {
            if (depth > 8) {
              truncated = true;
              return null;
            }
            if (typeof input === "string") {
              if (input.length > 10000) truncated = true;
              return input.slice(0, 10000);
            }
            if (
              typeof input === "number" ||
              typeof input === "boolean" ||
              input === null
            ) {
              return input;
            }
            if (Array.isArray(input)) {
              if (input.length > itemsLimit) truncated = true;
              return input
                .slice(-itemsLimit)
                .map((item) => project(item, itemsLimit, depth + 1));
            }
            if (!input || typeof input !== "object") return null;
            const entries = Object.entries(input);
            const result: Record<string, unknown> = {
              __fields: entries
                .filter(
                  ([key]) => !fields.has(key) && !/^[1-9]\d{0,30}$/u.test(key),
                )
                .slice(0, 100)
                .map(([key, item]) => ({
                  field: key,
                  type: Array.isArray(item) ? "array" : typeof item,
                })),
            };
            for (const [key, item] of entries) {
              if (fields.has(key) || /^[1-9]\d{0,30}$/u.test(key)) {
                result[key] = project(item, itemsLimit, depth + 1);
              }
            }
            return result;
          }
          for (const itemsLimit of [200, 100, 80, 40, 20, 10, 5, 1]) {
            truncated = false;
            const content = escape(JSON.stringify(project(value, itemsLimit)));
            const captured = `<section data-captured-chat-id="${chatId}" data-reader-version="0.2.29" data-read-host="${url.hostname}" data-expected-message-count="${expectedMessages ?? ""}" data-read-truncated="${truncated}" data-api-pages="${apiPages}" data-api-has-more="${messages.hasMore === true}" data-read-format="hh-chat-api-v1"><pre data-qa="chat-api-data">${content}</pre></section>`;
            if (captured.length <= 60000) return captured;
          }
          apiFailure = "response_limit";
        } else apiFailure = "response_limit";
      } else apiFailure = response.ok ? "non_json_response" : "http_error";
    } catch {
      apiFailure = "read_failed";
    }
  }
  if (embeddedRoot) return diagnostic();
  function visible(element: Element): boolean {
    const style = globalThis.getComputedStyle(element);
    return (
      !element.closest('[hidden],[aria-hidden="true"]') &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }
  // The HH shell contains no message history; its owned Chatik frame is read
  // concurrently. Do not make every chat wait for the shell's DOM fallback.
  if (
    embedded &&
    url.hostname !== "chatik.hh.ru" &&
    document.querySelector('iframe[src*="chatik.hh.ru"]')
  ) {
    return diagnostic();
  }
  function snapshot(): string | null {
    const bound = document.querySelector(
      `[data-chat-id="${chatId}"],[data-active-chat-id="${chatId}"]`,
    );
    const root =
      bound ?? document.querySelector('main,[role="main"]') ?? document.body;
    if (!root) return null;
    const messages = [...root.querySelectorAll("[data-qa]")].filter(
      (e) =>
        /message/iu.test(e.getAttribute("data-qa") ?? "") &&
        !/(?:input|composer|counter|empty|send|button)/iu.test(
          e.getAttribute("data-qa") ?? "",
        ) &&
        visible(e),
    );
    if (!messages.length && !(bound && expectedMessages === 0)) return null;
    function clean(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? "").replace(
          /[&<>]/gu,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? "",
        );
      }
      if (
        !(node instanceof Element) ||
        !visible(node) ||
        [
          "SCRIPT",
          "STYLE",
          "IFRAME",
          "INPUT",
          "TEXTAREA",
          "BUTTON",
          "SELECT",
          "NAV",
          "ASIDE",
        ].includes(node.tagName)
      ) {
        return "";
      }
      const allowed = [
        "data-qa",
        "data-message-id",
        "data-id",
        "data-sender-type",
        "data-author-type",
        "data-participant-type",
        "data-created-at",
        "datetime",
        "href",
        "class",
      ];
      const attrs = [...node.attributes]
        .filter((a) => allowed.includes(a.name))
        .map(
          (a) =>
            ` ${a.name}="${a.value.replace(/[&"<>]/gu, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c] ?? "")}"`,
        )
        .join("");
      const children = [...node.childNodes].map(clean).join("");
      return `<${node.tagName.toLowerCase()}${attrs}>${children}</${node.tagName.toLowerCase()}>`;
    }
    const containers = messages.filter(
      (e) => !messages.some((other) => other !== e && other.contains(e)),
    );
    const content = containers.map(clean).join("");
    const value = `<section data-captured-chat-id="${bound ? chatId : ""}" data-expected-message-count="${expectedMessages ?? ""}">${content}</section>`;
    return (content || (bound && expectedMessages === 0)) &&
      value.length <= 20000
      ? value
      : null;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const captured = snapshot();
    if (captured) return captured;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  // Structural diagnostics are safe to use to repair an adapter on the BFF.
  // They contain no message text, profile data, cookies or attribute values
  // other than public UI class/test names, and cannot masquerade as messages.
  return diagnostic();
  function diagnostic(): string {
    const diagnostics = {
      reader: "0.2.29",
      host: url.hostname,
      apiStatus,
      apiFailure,
      qa: [
        ...new Set(
          [...document.querySelectorAll("[data-qa]")].map((e) =>
            e.getAttribute("data-qa")?.slice(0, 64),
          ),
        ),
      ].slice(0, 16),
      classes: [
        ...new Set(
          [...document.querySelectorAll("[class]")].map((e) =>
            e.getAttribute("class")?.slice(0, 64),
          ),
        ),
      ].slice(0, 12),
      frameCount: document.querySelectorAll("iframe").length,
    };
    const report = `<section data-captured-chat-id="" data-read-format="hh-chat-diagnostic-v1"><pre data-qa="chat-read-diagnostic">${escape(JSON.stringify(diagnostics))}</pre></section>`;
    return report;
  }
}
