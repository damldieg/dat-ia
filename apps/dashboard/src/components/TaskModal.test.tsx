import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskModal } from './TaskModal';
import { makeSession, makeSoloTask, makeTask } from '../lib/testFixtures';
import type { TaskDetailDTO } from '../../shared/types';
import type { AsyncState } from '../lib/useAsync';

const task = makeTask();

const detail: TaskDetailDTO = {
  task,
  calls: [
    makeSession({
      id: 'ses_apply_1',
      parentId: 'ses_root',
      title: 'Implement API route',
      agent: 'sdd-apply',
      cost: { status: 'known', value: 0.5 },
      timeCreated: 1_790_000_000_000,
      timeUpdated: 1_790_000_150_000,
    }),
    makeSession({
      id: 'ses_verify',
      parentId: 'ses_root',
      title: 'Verify the change',
      agent: 'sdd-verify',
      cost: { status: 'known', value: 0.3 },
    }),
    makeSession({
      id: 'ses_apply_2',
      parentId: 'ses_apply_1',
      title: 'Fix failing test',
      agent: 'sdd-apply',
      cost: { status: 'known', value: 0.4 },
    }),
  ],
};

function render(state: AsyncState<TaskDetailDTO | null>, listed = task) {
  return renderToStaticMarkup(
    <TaskModal task={listed} detail={state} onRetry={() => undefined} onClose={() => undefined} />,
  );
}

describe('TaskModal', () => {
  test('is a labelled modal dialog with the task totals', () => {
    const markup = render({ status: 'ready', data: detail });
    expect(markup).toContain('<dialog');
    expect(markup).toContain('aria-labelledby="task-modal-title"');
    expect(markup).toContain('Add budget panel');
    expect(markup).toContain('$1.60'); // task
    expect(markup).toContain('$0.4000'); // orchestrator alone
    expect(markup).toContain('$1.20'); // subagents
    expect(markup).toContain('3 calls');
  });

  test('breaks the spend down by agent, orchestrator first, with each share', () => {
    const markup = render({ status: 'ready', data: detail });
    const breakdown = markup.slice(markup.indexOf('data-testid="task-breakdown"'), markup.indexOf('</tfoot>'));
    expect(breakdown).toContain('Orchestrator (main session)');
    expect(breakdown.indexOf('gentle-orchestrator')).toBeLessThan(breakdown.indexOf('sdd-apply'));
    expect(breakdown.indexOf('sdd-apply')).toBeLessThan(breakdown.indexOf('sdd-verify'));
    expect(breakdown).toContain('Share of cost');
    expect(breakdown).toContain('25%'); // orchestrator 0.4 of 1.6
    expect(breakdown).toContain('56%'); // sdd-apply 0.9 of 1.6
    expect(breakdown).toContain('19%'); // sdd-verify 0.3 of 1.6
    expect(breakdown).toContain('Task total');
  });

  test('lists every subagent call with its spend, nested calls under their caller', () => {
    const markup = render({ status: 'ready', data: detail });
    expect(markup.match(/data-testid="call-row"/g)).toHaveLength(3);
    const calls = markup.slice(markup.indexOf('data-testid="task-calls"'));
    expect(calls.indexOf('Implement API route')).toBeLessThan(calls.indexOf('Fix failing test'));
    expect(calls.indexOf('Fix failing test')).toBeLessThan(calls.indexOf('Verify the change'));
    expect(calls).toContain('↳');
    expect(calls).toContain('$0.5000');
    expect(calls).toContain('2m 30s');
  });

  test('shows the breakdown from the listed task while the calls are loading', () => {
    const markup = render({ status: 'loading' });
    expect(markup).toContain('data-testid="task-breakdown"');
    expect(markup).toContain('Loading subagent calls…');
    expect(markup).not.toContain('data-testid="task-calls"');
  });

  test('surfaces a load error with a retry action', () => {
    const markup = render({ status: 'error', message: 'Read-only query failed' });
    expect(markup).toContain('Read-only query failed');
    expect(markup).toContain('Retry');
  });

  test('falls back to a token share and an empty state for a task without subagents', () => {
    const solo = makeSoloTask();
    const markup = render({ status: 'ready', data: { task: solo, calls: [] } }, solo);
    expect(markup).toContain('Share of tokens');
    expect(markup).toContain('100%');
    expect(markup).toContain('The orchestrator did not call any subagent in this task.');
    expect(markup).not.toContain('data-testid="task-calls"');
  });

  test('warns when part of the task has no registered cost', () => {
    const partial = makeTask({ total: { ...task.total, costUnavailableSessions: 2 } });
    const markup = render({ status: 'ready', data: { task: partial, calls: detail.calls } }, partial);
    expect(markup).toContain('2 sessions in this task have no registered cost');
  });
});
