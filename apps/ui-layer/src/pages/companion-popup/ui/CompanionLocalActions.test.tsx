import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {CompanionLocalActions} from './CompanionLocalActions';
import type {CompanionPopupClient, LocalCompanionController, LocalCompanionState} from '../model/companion-popup';

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function fixture(status: string | null = 'pending') {
  const state: LocalCompanionState = {
    application: status ? {id: 'synthetic-a', version: 2, title: 'Тестовая вакансия', company: 'Тестовая компания', status} : null,
    page: status ? {url: 'https://hh.ru/vacancy/123', title: 'Тестовая страница', formDetected: true} : null,
    matches: status ? 1 : 0, total: status ? 1 : 0, busy: false, message: '', error: '', connection: null
  };
  let changed: (next: LocalCompanionState) => void = () => {};
  const controller: LocalCompanionController = {state, check: vi.fn(async () => {}), load: vi.fn(async () => {}), act: vi.fn(async () => {})};
  const client: CompanionPopupClient = {
    send: vi.fn(), open: vi.fn(async () => {}), subscribe: vi.fn(() => () => {}),
    createLocalController: vi.fn(async listener => {changed = listener; return controller;})
  };
  return {state, controller, client, change: async (next: Partial<LocalCompanionState>) => {await act(async () => {Object.assign(state, next); changed(state);});}};
}
async function mount(status: string | null = 'pending') {
  const fake = fixture(status);
  const rendered = render(<CompanionLocalActions client={fake.client} />);
  await waitFor(() => expect((screen.getByRole('button', {name: 'Обновить заявку открытой вакансии'}) as HTMLButtonElement).disabled).toBe(false));
  return {...fake, ...rendered};
}

it('offers a primary read action and page guidance before selecting an application', async () => {
  const fake = await mount(null);
  expect(screen.getByRole('heading', {name: 'Личная очередь на этом компьютере'})).toBeTruthy();
  expect(screen.getByText(/Эти заявки не относятся к очереди вашего кабинета/)).toBeTruthy();
  expect(screen.queryByRole('heading', {name: 'Выбранная заявка'})).toBeNull();
  expect(screen.queryByRole('button', {name: 'Подготовить эту заявку'})).toBeNull();
  expect(screen.queryByLabelText('Причина ожидания')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Обновить заявку открытой вакансии'}));
  await waitFor(() => expect(fake.controller.load).toHaveBeenCalledOnce());
  expect(fake.controller.act).not.toHaveBeenCalled();
});

it('serializes rapid prepare clicks before the controller reports its busy state', async () => {
  const fake = await mount();
  const result = deferred<unknown>();
  vi.mocked(fake.controller.act).mockReturnValue(result.promise);
  const button = screen.getByRole('button', {name: 'Подготовить эту заявку'});
  fireEvent.click(button); fireEvent.click(button);
  expect(fake.controller.act).toHaveBeenCalledExactlyOnceWith('prepare', '');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => result.resolve(undefined));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
});

it('requires explicit cancellation and rechecks the selected row version even without a rendered change', async () => {
  const fake = await mount();
  fireEvent.click(screen.getByRole('button', {name: 'Отменить эту заявку в очереди'}));
  await screen.findByRole('alertdialog');
  expect(fake.controller.act).not.toHaveBeenCalled();
  fake.state.application!.version++;
  fireEvent.click(screen.getByRole('button', {name: 'Отменить заявку'}));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(fake.controller.act).not.toHaveBeenCalled();
});

it('dismisses cancellation when the selected application loses the permitted state', async () => {
  const fake = await mount();
  fireEvent.click(screen.getByRole('button', {name: 'Отменить эту заявку в очереди'}));
  await screen.findByRole('alertdialog');
  await fake.change({application: {...fake.state.application!, status: 'claimed', version: 3}});
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(fake.controller.act).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', {name: 'Отменить эту заявку в очереди'})).toBeNull();
  expect(screen.getByLabelText('Причина ожидания')).toBeTruthy();
});

it('cancels a pending confirmation when the authorized local block is unmounted', async () => {
  const fake = await mount();
  fireEvent.click(screen.getByRole('button', {name: 'Отменить эту заявку в очереди'}));
  await screen.findByRole('alertdialog');
  fake.unmount();
  await act(async () => {});
  expect(fake.controller.act).not.toHaveBeenCalled();
});

it('limits claimed actions to delaying with a reason and clears the reason for a new selection', async () => {
  const fake = await mount('claimed');
  const delay = screen.getByRole('button', {name: 'Отложить заявку в работе'});
  expect((delay as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', {name: 'Подготовить эту заявку'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Причина ожидания'), {target: {value: '  Проверить резюме  '}});
  fireEvent.click(delay);
  await waitFor(() => expect(fake.controller.act).toHaveBeenCalledExactlyOnceWith('delay', 'Проверить резюме'));
  await fake.change({application: {...fake.state.application!, id: 'synthetic-b'}});
  expect((screen.getByLabelText('Причина ожидания') as HTMLTextAreaElement).value).toBe('');
  expect((delay as HTMLButtonElement).disabled).toBe(true);
});

it.each(['applied', 'delayed', 'cancelled', 'failed'])('offers only card access and refresh for %s', async status => {
  const fake = await mount(status);
  expect(screen.queryByRole('button', {name: 'Подготовить эту заявку'})).toBeNull();
  expect(screen.queryByRole('button', {name: 'Отменить эту заявку в очереди'})).toBeNull();
  expect(screen.queryByRole('button', {name: 'Отложить заявку в работе'})).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Открыть выбранную карточку'}));
  await waitFor(() => expect(fake.client.open).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/application?applicationId=synthetic-a'));
  expect(fake.controller.act).not.toHaveBeenCalled();
});

it('ignores an old controller factory failure after the client changes', async () => {
  const old = fixture(), latest = fixture('claimed'), pending = deferred<LocalCompanionController>();
  old.client.createLocalController = vi.fn(() => pending.promise);
  const rendered = render(<CompanionLocalActions client={old.client} />);
  rendered.rerender(<CompanionLocalActions client={latest.client} />);
  await screen.findByLabelText('Причина ожидания');
  await act(async () => pending.reject(new Error('Old factory failed')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('В работе')).toBeTruthy();
});

it('does not replace the new selection with a stale card-opening error', async () => {
  const fake = await mount(), pending = deferred<void>();
  vi.mocked(fake.client.open).mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole('button', {name: 'Открыть выбранную карточку'}));
  await fake.change({application: {...fake.state.application!, id: 'synthetic-b', title: 'Новая вакансия'}});
  await act(async () => pending.reject(new Error('Old opening failed')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Новая вакансия')).toBeTruthy();
});

it('does not retain a rejected delay error or its reason after selecting another application', async () => {
  const fake = await mount('claimed'), pending = deferred<unknown>();
  vi.mocked(fake.controller.act).mockReturnValue(pending.promise);
  fireEvent.change(screen.getByLabelText('Причина ожидания'), {target: {value: 'Проверить материалы'}});
  fireEvent.click(screen.getByRole('button', {name: 'Отложить заявку в работе'}));
  await fake.change({application: {...fake.state.application!, id: 'synthetic-b'}});
  await act(async () => pending.reject(new Error('Old action failed')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('Причина ожидания') as HTMLTextAreaElement).value).toBe('');
});
