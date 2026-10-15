import type { StorageArea } from "./companion-protocol.ts";

/** The browser capabilities used by the extension, rather than every Chrome API. */
export interface CompanionTab {
  id?: number;
  url?: string;
  status?: string;
  discarded?: boolean;
  frozen?: boolean;
}

export interface CompanionScript<Args extends unknown[], Result> {
  target: { tabId: number } & (
    | { documentIds: string[]; frameIds?: never }
    | { documentIds?: never; frameIds: number[] }
  );
  world: "ISOLATED";
  func: (...args: Args) => Result;
  args: Args;
}

export interface CompanionScriptResult<Result> {
  frameId: number;
  documentId?: string;
  result?: Result;
}

export interface ExecutionChromeApi {
  tabs: {
    query(options: { url: string[] }): Promise<CompanionTab[]>;
    create(options: { url: string; active: boolean }): Promise<CompanionTab>;
    get(tabId: number): Promise<CompanionTab>;
    update(
      tabId: number,
      options: { url?: string; autoDiscardable?: boolean },
    ): Promise<unknown>;
    remove(tabId: number): Promise<void>;
  };
  scripting: {
    executeScript<Args extends unknown[], Result>(
      script: CompanionScript<Args, Result>,
    ): Promise<CompanionScriptResult<Awaited<Result>>[]>;
  };
}

export type CompanionMessageListener = (
  message: unknown,
  sender: { id?: string; url?: string },
  respond: (value: unknown) => void,
) => boolean;

export interface WorkerChromeApi {
  storage: { local: StorageArea };
  alarms: {
    create(
      name: string,
      options: { periodInMinutes: number },
    ): void | Promise<void>;
    get?(name: string): Promise<unknown>;
    clear?(name: string): Promise<boolean>;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  runtime: {
    id?: string;
    getURL(path: string): string;
    onStartup: { addListener(listener: () => void): void };
    onInstalled?: { addListener(listener: () => void): void };
    onMessage: { addListener(listener: CompanionMessageListener): void };
  };
}

export type PairedChromeApi = WorkerChromeApi & ExecutionChromeApi;
