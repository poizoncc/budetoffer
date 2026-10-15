import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readVerifiedAccountIdentity} from '../apps/chrome-companion/hh/account.js';
const state = {userType: 'applicant', userId: '123456789', account: {}, hhidAccount: {},
  session: {isFallback: false, securityCheckFailed: false, isMultiAccount: false, hasExtraAccounts: false}};
const documentFor = (value: unknown) => ({querySelector: () => ({innerHTML: JSON.stringify(value)})});
test('HH identity uses the observed account schema and never substitutes a display name or requested ID', () => {
  assert.equal(readVerifiedAccountIdentity(documentFor(state)), 'hh-applicant-123456789');
  for (const changed of [{...state, userId: undefined}, {...state, userId: 123}, {...state, userType: 'employer'}, {...state, userId: '0'}, {...state, userId: '../other'}, {...state, account: null}]) assert.equal(readVerifiedAccountIdentity(documentFor(changed)), null);
  for (const field of Object.keys(state.session)) assert.equal(readVerifiedAccountIdentity(documentFor({...state, session: {...state.session, [field]: true}})), null);
  assert.equal(readVerifiedAccountIdentity(), null);
});
