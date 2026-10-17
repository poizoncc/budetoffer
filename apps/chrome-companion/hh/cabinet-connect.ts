// Classic isolated-world content script. No credentials cross into the page.
(() => {
  if (window.top !== window) return;
  let busy = false;
  window.addEventListener("message", (event) => {
    const message: unknown = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !message ||
      typeof message !== "object" ||
      Array.isArray(message)
    ) {
      return;
    }
    const value = message as Record<string, unknown>;
    if (
      value.type !== "budetoffer:cabinet-connect-request" ||
      typeof value.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{16,64}$/u.test(value.requestId) ||
      !["start", "status"].includes(String(value.action)) ||
      busy
    ) {
      return;
    }
    busy = true;
    void chrome.runtime
      .sendMessage({
        type:
          value.action === "start"
            ? "chairs:cabinet-start-login"
            : "chairs:cabinet-login-status",
      })
      .then((response: unknown) => {
        const result =
          response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : {};
        window.postMessage(
          {
            type: "budetoffer:cabinet-connect-response",
            requestId: value.requestId,
            ok: result.ok === true,
            paired: result.paired === true,
            deviceId:
              typeof result.deviceId === "string" ? result.deviceId : null,
            userCode:
              typeof result.userCode === "string" ? result.userCode : null,
            onboardingRequired: result.onboardingRequired === true,
          },
          location.origin,
        );
      })
      .catch(() =>
        window.postMessage(
          {
            type: "budetoffer:cabinet-connect-response",
            requestId: value.requestId,
            ok: false,
          },
          location.origin,
        ),
      )
      .finally(() => {
        busy = false;
      });
  });
})();
