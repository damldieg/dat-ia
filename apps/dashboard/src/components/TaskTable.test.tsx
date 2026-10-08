import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskTable } from './TaskTable';
import { makeSoloTask, makeTask } from '../lib/testFixtures';
import type { TaskDTO } from '../../shared/types';

function render(tasks: TaskDTO[] = [makeTask()], selectedId: string | null = null) {
  return renderToStaticMarkup(
    <TaskTable tasks={tasks} total={tasks.length} selectedId={selectedId} onSelect={() => undefined} />,
  );
}

describe('TaskTable', () => {
  test('renders one row per task with the orchestrator agent and model', () => {
    const markup = render([makeTask(), makeSoloTask()]);
    expect(markup.match(/data-testid="task-row"/g)).toHaveLength(2);
    expect(markup).toContain('Add budget panel');
    expect(markup).toContain('gentle-orchestrator');
    expect(markup).toContain('opencode-go/gpt-6-luna#medium');
    expect(markup).toContain('dat-ia');
  });

  test('classifies the subagent calls by agent inside the task row', () => {
    const markup = render();
    expect(markup).toContain('3 calls');
    expect(markup).toMatch(/sdd-apply<span class="chip__count">×2<\/span>/);
    expect(markup).toMatch(/sdd-verify<span class="chip__count">×1<\/span>/);
  });

  test('shows the task total and the subagent share of the cost', () => {
    const markup = render();
    expect(markup).toContain('$1.60');
    expect(markup).toContain('subagents');
    expect(markup).toContain('$1.20');
    expect(markup).toContain('75.0k'); // 62k input + 13k output across the task
  });

  test('a task without subagents shows a dash and no subagent cost line', () => {
    const markup = render([makeSoloTask()]);
    expect(markup).toContain('class="tasks__none"');
    expect(markup).not.toContain('class="chips"');
    expect(markup).not.toContain('subagents');
  });

  test('collapses long agent lists and marks the selected row', () => {
    const base = makeTask();
    const agents = ['a', 'b', 'c', 'd', 'e', 'f'].map((agent) => ({ ...base.agents[0]!, agent, calls: 1 }));
    const markup = render([makeTask({ agents, subagentCalls: 6 })], 'ses_root');
    expect(markup).toContain('+2 more');
    expect(markup).toContain('is-selected');
  });

  test('keeps an unregistered cost as an em dash, never as zero', () => {
    const solo = makeSoloTask();
    const markup = render([
      {
        ...solo,
        session: { ...solo.session, model: null, modelKey: null, cost: { status: 'unavailable', reason: 'no-registered-model' } },
        total: { ...solo.total, costKnownSessions: 0, costUnavailableSessions: 1 },
      },
    ]);
    expect(markup).toContain('data-status="unavailable"');
    expect(markup).not.toContain('$0.00');
  });
});
