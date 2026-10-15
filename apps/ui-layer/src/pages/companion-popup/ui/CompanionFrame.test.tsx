import {afterEach, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {CompanionFrame} from './CompanionFrame';

afterEach(cleanup);

it('labels progress and the current step in words and displays the provided brand asset', () => {
  render(<CompanionFrame stage="onboarding" logoUrl="/synthetic-brand.svg"><p>Содержимое</p></CompanionFrame>);
  expect(screen.getByRole('heading', {name: 'BudetOffer', level: 1})).toBeTruthy();
  expect(document.querySelector('.companion-brand')?.getAttribute('src')).toBe('/synthetic-brand.svg');
  expect(document.querySelector('.companion-brand')?.getAttribute('alt')).toBe('');
  const steps = screen.getByRole('list', {name: 'Подключение расширения'});
  expect(steps.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(steps.querySelector('[aria-current="step"]')?.textContent).toMatch(/Условия/);
  expect(screen.getByRole('status').textContent).toBe('Осталось подтвердить условия');
});

it('does not imply a completed login when state is unavailable', () => {
  render(<CompanionFrame stage="unavailable" footer={<button>Повторить проверку</button>}><p>Подключение недоступно</p></CompanionFrame>);
  const steps = screen.getByRole('list', {name: 'Подключение расширения'});
  expect(steps.querySelectorAll('[data-complete="true"]')).toHaveLength(0);
  expect(screen.getByRole('button', {name: 'Повторить проверку'})).toBeTruthy();
});
