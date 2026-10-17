/** Read-only DOM capture from a chat selected by an owned negotiation row.
 * No cookies, headers, scripts, hidden nodes, inputs or executable HTML leave
 * this document. The server treats unknown author/format as unverified.
 */
export async function readChatSnapshot(
  chatId: string,
  expectedMessages: number | null = null,
): Promise<string | null> {
  const url = new URL(globalThis.location.href);
  if (
    url.protocol !== "https:" ||
    !["hh.ru", "chatik.hh.ru"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/chat/${chatId}` ||
    url.search ||
    !/^[1-9]\d{0,30}$/u.test(chatId)
  ) {
    throw new Error("history_target_mismatch");
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
  return null;
}
