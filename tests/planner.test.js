import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPlan } from '../src/planner.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../data/${name}-plan.v1.json`, import.meta.url)));
test('academic and project examples match DeadlinePlan', () => {
  const student = runPlan(fixture('student'));
  assert.equal(student.ok, true);
  assert.deepEqual(student.blocks.map((b) => b.task_id), ['biology-review', 'calculus-homework', 'biology-review', 'biology-review', 'exam-setup']);
  assert.deepEqual(student.blocks.map((b) => b.confirmed), [true, false, false, false, false]);
  assert.equal(student.unscheduled.length, 0);
  const project = runPlan(fixture('project'));
  assert.equal(project.ok, true);
  assert.deepEqual(project.blocks.map((b) => b.task_id), ['design', 'design', 'release']);
  assert.equal(project.unscheduled.length, 0);
});
const base = (tasks, extras = {}) => ({ schema_version: 1, availability: [{ start: 0, end: 120 }], fixed_events: [], tasks, completed: [], confirmed_blocks: [], ...extras });
const t = (id, duration_minutes, deadline = 120, dependencies = [], minimum_block_minutes) => ({ id, duration_minutes, deadline, dependencies, ...(minimum_block_minutes ? { minimum_block_minutes } : {}) });
test('split gaps, dependency completion, rollback and short tail', () => {
  const plan = base([t('work', 60, 100, [], 40), t('next', 10, 120, ['work'])], {
    fixed_events: [{ id: 'call', start: 50, end: 60 }],
    confirmed_blocks: [{ task_id: 'work', start: 0, end: 50 }],
  });
  assert.deepEqual(runPlan(plan).blocks.map(({ start, end }) => [start, end]), [[0, 50], [60, 70], [70, 80]]);
  plan.fixed_events.push({ id: 'busy', start: 60, end: 120 });
  const blocked = runPlan(plan);
  assert.deepEqual(blocked.blocks.map(({ start, end }) => [start, end]), [[0, 50]]);
  assert.deepEqual(blocked.unscheduled.map(({ reason }) => reason.code), ['SplitWorkIncomplete', 'DependencyNotScheduled']);
  assert.equal(blocked.unscheduled[0].reason.remaining_minutes, 10);
});
test('confirmed conflict, unknown dependency, version and type have paths', () => {
  const p = base([t('work', 20)], { confirmed_blocks: [{ task_id: 'work', start: 0, end: 20 }] });
  p.fixed_events.push({ id: 'class', start: 10, end: 30 });
  assert.equal(runPlan(p).error.kind, 'ConfirmedOverlapsFixedEvent');
  p.fixed_events = [];
  p.tasks[0].dependencies = ['missing'];
  assert.equal(runPlan(p).error.path, '/tasks/0/dependencies/0');
  p.tasks[0].dependencies = [];
  p.schema_version = 2;
  assert.equal(runPlan(p).error.kind, 'UnsupportedSchemaVersion');
  p.schema_version = 1;
  p.tasks[0].deadline = 1.2;
  assert.equal(runPlan(p).error.path, '/tasks/0/deadline');
});
test('equal deadlines use input order; Int32 boundary is safe', () => {
  const r = runPlan(base([t('first', 10, 20), t('second', 10, 20)]));
  assert.deepEqual(r.blocks.map((b) => b.task_id), ['first', 'second']);
  const extreme = base([t('edge', 5, 2147483647)], { availability: [{ start: 2147483642, end: 2147483647 }] });
  assert.equal(runPlan(extreme).blocks[0].end, 2147483647);
});
test('plain split work needs a minimum in every block', () => {
  const plan = base([t('write', 60, 120, [], 40)], {
    availability: [{ start: 0, end: 50 }, { start: 60, end: 70 }],
  });
  const result = runPlan(plan);
  assert.equal(result.blocks.length, 0);
  assert.deepEqual(result.unscheduled[0].reason, { code: 'SplitWorkIncomplete', remaining_minutes: 60 });
});
test('completed and confirmed timelines are checked before scheduling', () => {
  const p = base([t('draft', 10), t('review', 10, 120, ['draft'])], {
    completed: [{ id: 'review', completed_at: 30 }],
  });
  assert.equal(runPlan(p).error.kind, 'UnresolvedPriorDependency');
  p.completed.push({ id: 'draft', completed_at: 40 });
  assert.equal(runPlan(p).error.kind, 'PriorDependencyFinishesLate');
  p.completed[1].completed_at = 20;
  assert.equal(runPlan(p).ok, true);
});
test('JSON syntax, missing and unexpected fields are explicit', () => {
  assert.equal(runPlan('{').error.kind, 'JsonSyntax');
  const p = base([]);
  delete p.completed;
  assert.equal(runPlan(p).error.path, '/completed');
  p.completed = []; p.secret = 'discard me';
  assert.equal(runPlan(p).error.kind, 'UnexpectedField');
});
