/** Read-only DOM capture from a chat selected by an owned negotiation row.
 * No cookies, headers, scripts, hidden nodes, inputs or executable HTML leave
 * this document. The server treats unknown author/format as unverified.
 */
export async function readChatSnapshot(
  chatId: string,
  expectedMessages: number | null = null,
  embedded = false,
): Promise<string | null> {
  const url = new URL(globalThis.location.href);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)hh\.ru$/u.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/chat/${chatId}` ||
    [...url.searchParams].some(
      ([key, value]) =>
        !["without_list", "platform", "theme"].includes(key) ||
        !/^[A-Za-z0-9_-]{1,32}$/u.test(value),
    ) ||
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
          const fields = new Set([
            "chat",
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
          for (const itemsLimit of [100, 40, 20, 10, 5, 1]) {
            truncated = false;
            const content = escape(JSON.stringify(project(value, itemsLimit)));
            const captured = `<section data-captured-chat-id="${chatId}" data-expected-message-count="${expectedMessages ?? ""}" data-read-truncated="${truncated}" data-read-format="hh-chat-api-v1"><pre data-qa="chat-api-data">${content}</pre></section>`;
            if (captured.length <= 20000) return captured;
          }
          apiFailure = "response_limit";
        } else apiFailure = "response_limit";
      } else apiFailure = response.ok ? "non_json_response" : "http_error";
    } catch {
      apiFailure = "read_failed";
    }
  }
  function visible(element: Element): boolean {
    const style = globalThis.getComputedStyle(element);
    return (
      !element.closest('[hidden],[aria-hidden="true"]') &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
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
  const diagnostics = {
    reader: "0.2.25",
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
