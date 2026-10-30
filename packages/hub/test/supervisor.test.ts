import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeClock } from '@notespark/sync-protocol';
import { type Child, Supervisor } from '../src/supervisor.ts';

const harness = (opts = {}) => {
  const clock = new FakeClock();
  const children: { exit(): void; killed: boolean }[] = [];
  const states: string[] = [];
  const sup = new Supervisor({
    clock, onState: s => states.push(s), ...opts,
    spawn: (): Child => {
      let cb = () => {};
      const c = { killed: false, exit: () => cb() };
      children.push(c);
      return { kill: () => { c.killed = true; cb(); }, onExit: f => { cb = f; } };
    },
  });
  return { clock, children, states, sup };
};

test('back-off doubles from 1 s to 60 s and stays there', async () => {
  const { clock, children, sup } = harness();
  sup.start();
  const waits: number[] = [];
  for (let i = 0; i < 9; i++) {
    const before = children.length;
    children.at(-1)!.exit();
    let t = 0;
    while (children.length === before && t < 70_000) { await clock.advance(500); t += 500; }
    waits.push(t);
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(sup.restarts, 9);
});

test('a process that ran a stable minute resets the back-off; one that did not does not', async () => {
  const { clock, children, sup } = harness();
  sup.start();
  children[0].exit(); await clock.advance(1000);
  children[1].exit(); await clock.advance(2000);
  assert.equal(children.length, 3);
  await clock.advance(61_000);
  children[2].exit();
  await clock.advance(999);
  assert.equal(children.length, 3);
  await clock.advance(1);
  assert.equal(children.length, 4); // back to 1 s
});

test('stop is final: no restart, the process is killed; kick restarts a silent process; a spawn that throws is retried', async () => {
  const h = harness();
  h.sup.start();
  h.sup.kick();
  assert.equal(h.sup.state, 'restarting');
  await h.clock.advance(1000);
  assert.equal(h.children.length, 2);
  h.sup.stop();
  assert.ok(h.children[1].killed);
  await h.clock.advance(120_000);
  assert.equal(h.children.length, 2);
  assert.equal(h.sup.state, 'stopped');
  let tries = 0;
  const clock = new FakeClock();
  const sup = new Supervisor({ clock, spawn: () => { if (++tries < 3) throw new Error('no'); return { kill() {}, onExit() {} }; } });
  sup.start();
  await clock.advance(1000); await clock.advance(2000);
  assert.equal(tries, 3);
  assert.equal(sup.state, 'running');
});
