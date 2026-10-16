import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { readPageEvidence } from "../apps/chrome-companion/hh/actions.ts";
import { runSerialized } from "./helpers/chrome.ts";

const expectedUrl = "https://hh.ru/search/vacancy?text=frontend&area=1&page=0";
const state = {
  vacancySearchResult: {
    vacancies: [
      {
        vacancyId: 123,
        name: "Synthetic engineer",
        company: { visibleName: "Synthetic company" },
      },
    ],
    paging: {
      pages: [{ page: 0, selected: true }],
      next: { disabled: true },
    },
  },
};

function readSearch(actualUrl: string, requestedUrl = expectedUrl) {
  const dom = new JSDOM(
    `<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`,
    { url: actualUrl, runScripts: "outside-only" },
  );
  try {
    return runSerialized(dom, readPageEvidence, [
      { operation: "search", expectedUrl: requestedUrl, page: 0 },
    ]);
  } finally {
    dom.window.close();
  }
}

test("serialized search reader accepts the same search on canonical and regional HH hosts", () => {
  for (const origin of [
    "https://hh.ru",
    "https://kaliningrad.hh.ru",
    "https://spb.hh.ru",
  ]) {
    const result = readSearch(expectedUrl.replace("https://hh.ru", origin));
    assert.equal("vacancies" in result, true);
    if (!("vacancies" in result)) throw new Error("search_result_expected");
    assert.equal(result.vacancies.length, 1);
    assert.equal(result.vacancies[0]?.vacancyId, "123");
    assert.equal(result.hasNext, false);
  }
});

test("serialized regional search reader refuses foreign or unsafe actual URLs", () => {
  for (const origin of [
    "https://hh.ru.example.invalid",
    "https://kaliningrad-hh.ru",
    "https://example.invalid",
    "http://kaliningrad.hh.ru",
    "https://kaliningrad.hh.ru:8443",
    "https://user@kaliningrad.hh.ru",
    "https://user:password@kaliningrad.hh.ru",
    "https://kaliningrad.hh.ru.",
  ]) {
    assert.throws(
      () => readSearch(expectedUrl.replace("https://hh.ru", origin)),
      /unexpected_hh_navigation/u,
    );
  }
});

test("serialized regional search reader keeps the exact search path and query", () => {
  const regional = expectedUrl.replace("https://hh.ru", "https://spb.hh.ru");
  for (const changed of [
    regional.replace("frontend", "backend"),
    regional.replace("area=1", "area=2"),
    regional.replace("page=0", "page=1"),
    regional.replace("text=frontend&area=1", "area=1&text=frontend"),
    regional + "&period=1",
    regional.replace("/search/vacancy", "/search/vacancy/"),
    regional.replace("/search/vacancy", "/account/login"),
    regional.replace("/search/vacancy", "/vacancy/123"),
  ]) {
    assert.throws(() => readSearch(changed), /unsupported_hh_page/u);
  }
  assert.throws(
    () => readSearch(regional + "#other"),
    /unexpected_hh_navigation/u,
  );
});

test("serialized search reader validates its expected HH target independently", () => {
  for (const requested of [
    expectedUrl.replace("https://hh.ru", "https://example.invalid"),
    expectedUrl.replace("https://hh.ru", "http://hh.ru"),
    expectedUrl.replace("https://hh.ru", "https://hh.ru:8443"),
    expectedUrl.replace("https://hh.ru", "https://user@hh.ru"),
    expectedUrl + "#other",
    expectedUrl.replace("/search/vacancy", "/account/login"),
    "invalid-url",
  ]) {
    assert.throws(
      () => readSearch(expectedUrl, requested),
      /unsupported_hh_page/u,
    );
  }
});
