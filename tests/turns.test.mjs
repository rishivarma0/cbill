import assert from 'node:assert/strict';
import test from 'node:test';
import { afterNextPayment, nextAfter, resolveNextPayer } from '../lib/turns.ts';

const member = (username, due, active = true) => ({
  username,
  display_name: username,
  role: 'member',
  current_due: due,
  advance_credit: 0,
  total_paid: 0,
  next_payment: Math.min(500, due),
  is_active: active,
});

test('uses the backend next payment and preserves accumulated due', () => {
  const nandan = member('nandan', 800);
  assert.equal(nandan.next_payment, 500);
  assert.equal(afterNextPayment(nandan), 300);
  const partial = member('nandan', 300);
  assert.equal(partial.next_payment, 300);
  assert.equal(afterNextPayment(partial), 0);
});

test('rotation skips covered and inactive roommates', () => {
  const members = [member('rishi', 0), member('mohan', 500), member('nandan', 800), member('later', 500, false)];
  assert.equal(resolveNextPayer(members, 'rishi')?.username, 'mohan');
  assert.equal(nextAfter(members, 'mohan')?.username, 'nandan');
  assert.equal(nextAfter([member('rishi', 0), member('mohan', 0)], 'mohan'), null);
});
