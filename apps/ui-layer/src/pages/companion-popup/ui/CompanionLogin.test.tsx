import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {CompanionLogin, type CompanionLoginProps} from './CompanionLogin';

vi.mock('qrcode', () => ({default: {toDataURL: vi.fn(async () => 'data:image/png;base64,c3ludGhldGlj')}}));
afterEach(cleanup);
const origin = 'http://127.0.0.1:6971';
function props(overrides: Partial<CompanionLoginProps> = {}): CompanionLoginProps {
  return {config: {origin, serverOnly: true}, status: {ok: true, paired: false}, busy: false, code: '', onCodeChange: vi.fn(), onStart: vi.fn(), onPair: vi.fn(), onRefresh: vi.fn(), onOpen: vi.fn(), ...overrides};
}
const pending = {userCode: '4GN-5TY', verificationUri: `${origin}/#companion-connect=4GN-5TY`, expiresAt: '2099-10-10T12:00:00Z', phoneReachable: false};

it('keeps the cabinet code alternative in a keyboard-accessible native disclosure and accepts pasted codes', () => {
  const handlers = props({code: '4gn5ty'});
  render(<CompanionLogin {...handlers} />);
  expect(screen.getByRole('button', {name: 'Получить код входа'})).toBeTruthy();
  const summary = screen.getByText('У меня уже есть код из кабинета');
  expect(summary.parentElement?.tagName).toBe('DETAILS');
  expect(summary.parentElement?.hasAttribute('open')).toBe(false);
  fireEvent.click(summary);
  const input = screen.getByLabelText('Код из кабинета');
  expect(input.getAttribute('autocomplete')).toBe('one-time-code');
  fireEvent.change(input, {target: {value: '4gn-5ty'}});
  expect(handlers.onCodeChange).toHaveBeenCalledWith('4GN-5TY');
  fireEvent.click(screen.getByRole('button', {name: 'Войти по коду'}));
  expect(handlers.onPair).toHaveBeenCalledOnce();
});

it('shows a code deadline locally without a QR and opens approval only after a deliberate click', () => {
  const handlers = props({status: {ok: true, paired: false, pendingLogin: pending}});
  render(<CompanionLogin {...handlers} />);
  expect(screen.getByText('4GN-5TY')).toBeTruthy();
  expect(screen.getByText(/Действует до/).querySelector('time')?.getAttribute('dateTime')).toBe(pending.expiresAt);
  expect(screen.queryByRole('img')).toBeNull();
  expect(handlers.onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Подтвердить в кабинете'}));
  expect(handlers.onOpen).toHaveBeenCalledWith(pending.verificationUri);
});

it('replaces expired confirmation with an explicit new code action', () => {
  const handlers = props({status: {ok: true, paired: false, pendingLogin: pending}, loginExpired: true});
  render(<CompanionLogin {...handlers} />);
  expect(screen.getByRole('heading', {name: 'Время входа истекло'})).toBeTruthy();
  expect(screen.queryByRole('button', {name: 'Подтвердить в кабинете'})).toBeNull();
  expect(screen.queryByText('4GN-5TY')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Получить новый код'}));
  expect(handlers.onStart).toHaveBeenCalledOnce();
});

it('never displays an opaque token or generates a QR for an unsafe or foreign approval URL', () => {
  const handlers = props({status: {ok: true, paired: false, pendingLogin: {...pending, phoneReachable: true, verificationUri: 'https://foreign.test/#secret-token=opaque-private-token'}}});
  render(<CompanionLogin {...handlers} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', {name: 'Подтвердить в кабинете'})).toBeNull();
  expect(document.body.textContent).not.toMatch(/opaque-private-token|foreign\.test/);
});

it('generates a local QR image only for a reachable HTTPS cabinet', async () => {
  const handlers = props({config: {origin: 'https://cabinet.example.test', serverOnly: true}, status: {ok: true, paired: false, pendingLogin: {...pending, phoneReachable: true, verificationUri: 'https://cabinet.example.test/#companion-connect=4GN-5TY'}}});
  render(<CompanionLogin {...handlers} />);
  const image = await screen.findByRole('img', {name: 'QR-код для подтверждения входа в Chrome'});
  expect(image.getAttribute('src')).toMatch(/^data:image/);
  expect(handlers.onOpen).not.toHaveBeenCalled();
});
