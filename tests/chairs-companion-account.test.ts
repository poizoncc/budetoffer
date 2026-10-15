import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { readVerifiedAccountIdentity } from "../apps/chrome-companion/hh/account.ts";
const state = {
  userType: "applicant",
  userId: "123456789",
  account: {},
  hhidAccount: {},
  session: {
    isFallback: false,
    securityCheckFailed: false,
    isMultiAccount: false,
    hasExtraAccounts: false,
  },
};
function identityFor(value: unknown) {
  const dom = new JSDOM(
    `<template id="HH-Lux-InitialState">${JSON.stringify(value)}</template>`,
  );
  try {
    return readVerifiedAccountIdentity(dom.window.document);
  } finally {
    dom.window.close();
  }
}
test("HH identity uses the observed account schema and never substitutes a display name or requested ID", () => {
  assert.equal(identityFor(state), "hh-applicant-123456789");
  for (const changed of [
    { ...state, userId: undefined },
    { ...state, userId: 123 },
    { ...state, userType: "employer" },
    { ...state, userId: "0" },
    { ...state, userId: "../other" },
    { ...state, account: null },
  ]) {
    assert.equal(identityFor(changed), null);
  }
  for (const field of Object.keys(state.session)) {
    assert.equal(
      identityFor({ ...state, session: { ...state.session, [field]: true } }),
      null,
    );
  }
  assert.equal(readVerifiedAccountIdentity(), null);
});
