import React from 'react';
import {createRoot} from 'react-dom/client';
import {CompanionPopup, parseCompanionStatus, type CompanionPopupClient, type CompanionPopupConfig} from '@/pages/companion-popup';
import './popup.css';
import {localControllerFactory} from './local-client';

const chromePopup = chrome;
const client: CompanionPopupClient = {
  send: async message => parseCompanionStatus(await chromePopup.runtime.sendMessage(message)),
  open: async url => {await chromePopup.tabs.create({url});},
  subscribe: changed => {chromePopup.storage.onChanged.addListener(changed); return () => chromePopup.storage.onChanged.removeListener(changed);}
};
async function boot() {
  const publicDestinations = chromePopup.runtime.getURL('shared/destinations.js');
  const destinations: unknown = await import(/* @vite-ignore */ publicDestinations);
  if (typeof destinations !== 'object' || destinations === null || !('SERVER_ORIGIN' in destinations)
    || !(destinations.SERVER_ORIGIN === null || typeof destinations.SERVER_ORIGIN === 'string')
    || !('COMPANION_ORIGINS' in destinations) || !Array.isArray(destinations.COMPANION_ORIGINS)
    || !destinations.COMPANION_ORIGINS.length || !destinations.COMPANION_ORIGINS.every((origin: unknown): origin is string => typeof origin === 'string')) throw new Error('invalid_companion_destinations');
  const config: CompanionPopupConfig = {origin: destinations.SERVER_ORIGIN ?? destinations.COMPANION_ORIGINS.find(origin => origin.endsWith(':6971')) ?? destinations.COMPANION_ORIGINS[0], serverOnly: Boolean(destinations.SERVER_ORIGIN), logoUrl: chromePopup.runtime.getURL('assets/budetoffer-logo.svg')};
  if (!config.serverOnly) client.createLocalController = localControllerFactory(chromePopup, config.origin);
  const root = document.getElementById('root');
  if (!root) throw new Error('popup_root_missing');
  createRoot(root).render(<React.StrictMode><CompanionPopup client={client} config={config} /></React.StrictMode>);
}
void boot().catch(() => {const root = document.getElementById('root'); if (root) root.textContent = 'Не удалось открыть BudetOffer. Обновите расширение и повторите вход.';});
