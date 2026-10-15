import React from 'react';
import {createRoot} from 'react-dom/client';
import {CompanionPopup, type CompanionPopupClient, type CompanionPopupConfig} from '@/pages/companion-popup';
import './popup.css';
import {localControllerFactory, type ChromeLocalApi} from './local-client';

type Listener = () => void;
type ChromePopup = {runtime: {getURL: (path: string) => string; sendMessage: CompanionPopupClient['send']}; tabs: {create: (options: {url: string}) => Promise<unknown>}; storage: {onChanged: {addListener: (callback: Listener) => void; removeListener: (callback: Listener) => void}}};
const chromePopup = (globalThis as typeof globalThis & {chrome: ChromePopup}).chrome;
const client: CompanionPopupClient = {
  send: message => chromePopup.runtime.sendMessage(message),
  open: async url => {await chromePopup.tabs.create({url});},
  subscribe: changed => {chromePopup.storage.onChanged.addListener(changed); return () => chromePopup.storage.onChanged.removeListener(changed);}
};
async function boot() {
  const publicDestinations = chromePopup.runtime.getURL('shared/destinations.js');
  const destinations = await import(/* @vite-ignore */ publicDestinations) as {SERVER_ORIGIN: string | null; COMPANION_ORIGINS: string[]};
  const config: CompanionPopupConfig = {origin: destinations.SERVER_ORIGIN ?? destinations.COMPANION_ORIGINS.find(origin => origin.endsWith(':6971')) ?? destinations.COMPANION_ORIGINS[0], serverOnly: Boolean(destinations.SERVER_ORIGIN), logoUrl: chromePopup.runtime.getURL('assets/budetoffer-logo.svg')};
  if (!config.serverOnly) client.createLocalController = localControllerFactory(chromePopup as typeof chromePopup & ChromeLocalApi, config.origin);
  createRoot(document.getElementById('root')!).render(<React.StrictMode><CompanionPopup client={client} config={config} /></React.StrictMode>);
}
void boot().catch(() => {const root = document.getElementById('root'); if (root) root.textContent = 'Не удалось открыть BudetOffer. Обновите расширение и повторите вход.';});
