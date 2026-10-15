import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompanionOnboarding } from "./CompanionOnboarding";

afterEach(cleanup);
const origin = "http://127.0.0.1:6971";
const links = {
  termsUrl: `${origin}/legal/terms`,
  privacyUrl: `${origin}/legal/privacy`,
};

it("requires an explicit adult choice and every agreement before continuing", () => {
  const accept = vi.fn();
  const open = vi.fn();
  render(
    <CompanionOnboarding
      origin={origin}
      legalLinks={links}
      busy={false}
      onAccept={accept}
      onOpenDocument={open}
    />,
  );
  const proceed = screen.getByRole("button", {
    name: "Продолжить",
  }) as HTMLButtonElement;
  expect(
    screen.getByRole("region", { name: "Работа компьютера" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Возраст и документы" }),
  ).toBeTruthy();
  expect(proceed.disabled).toBe(true);
  expect(
    screen
      .getByRole("switch", { name: "Мне есть 18" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  for (const checkbox of screen.getAllByRole("checkbox")) {
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  }
  fireEvent.click(
    screen.getByRole("button", { name: "Пользовательское соглашение" }),
  );
  expect(open).toHaveBeenCalledWith(links.termsUrl);
  expect(proceed.disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "Мне есть 18" }));
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Компьютер и Chrome останутся включёнными",
    }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Принимаю пользовательское соглашение",
    }),
  );
  expect(proceed.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Соглашаюсь с политикой конфиденциальности",
    }),
  );
  expect(proceed.disabled).toBe(false);
  fireEvent.click(proceed);
  expect(accept).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Принимаю пользовательское соглашение",
    }),
  );
  expect(proceed.disabled).toBe(true);
});

it("cannot complete onboarding with missing or unsafe document URLs", () => {
  render(
    <CompanionOnboarding
      origin={origin}
      legalLinks={{ termsUrl: "javascript:alert(1)", privacyUrl: null }}
      busy={false}
      onAccept={vi.fn()}
      onOpenDocument={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toMatch(/ещё не настроены/);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Принимаю пользовательское соглашение",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Продолжить" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
