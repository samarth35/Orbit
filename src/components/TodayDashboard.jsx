import { useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trophy
} from 'lucide-react';

export default function TodayDashboard({
  tasks,
  openTasks,
  doneTasks,
  routines,
  todayEvents,
  currentScore,
  focus,
  onNavigate,
  onQuickAdd,
  onToggleTask,
  onUpdateRoutine,
  onToggleFocus,
  onResetFocus,
  reactor
}) {
  const [draft, setDraft] = useState('');
  const submit = (event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onQuickAdd(draft);
    setDraft('');
  };
  return (
    <div className="today-dashboard">
      <header className="dashboard-heading">
        <div>
          <h1>Today</h1>
          <p>A little structure. A lot more focus.</p>
        </div>
        <button
          type="button"
          className="dashboard-primary"
          onClick={() => onNavigate('Tasks')}
        >
          <Plus size={18} />
          Add task
        </button>
      </header>
      <div className="dashboard-metrics" aria-label="Today's progress">
        <div>
          <Trophy />
          <span>
            Lock-in score<strong>{Math.round(currentScore?.score ?? 0)}</strong>
          </span>
        </div>
        <div>
          <CheckCircle2 />
          <span>
            Tasks completed
            <strong>
              {doneTasks.length}
              <small>/{tasks.length}</small>
            </strong>
          </span>
        </div>
        <div>
          <Clock3 />
          <span>
            Focus today
            <strong>
              {currentScore?.validFocusMinutes ?? 0}
              <small> min</small>
            </strong>
          </span>
        </div>
      </div>
      <div className="dashboard-columns">
        <div className="dashboard-left">
          <section className="dashboard-panel dashboard-tasks">
            <h2>Your tasks</h2>
            <form className="dashboard-capture" onSubmit={submit}>
              <Plus size={20} />
              <input
                aria-label="Quick task"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="What needs your attention?"
                maxLength={500}
              />
              <button type="submit" disabled={!draft.trim()}>
                Add
              </button>
            </form>
            {openTasks.length ? (
              <ul className="dashboard-task-list">
                {openTasks.slice(0, 5).map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      aria-label={`Complete ${task.title}`}
                      onClick={() => onToggleTask(task.id)}
                    >
                      <Circle size={21} />
                    </button>
                    <span>
                      {task.title}
                      <small>{task.date || task.meta}</small>
                    </span>
                    <em>{task.priority}</em>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dashboard-empty">
                <CheckCircle2 size={42} strokeWidth={1.3} />
                <strong>A clear slate</strong>
                <p>Add your first task to start shaping your day.</p>
              </div>
            )}
            {openTasks.length > 5 ? (
              <button
                type="button"
                className="dashboard-link"
                onClick={() => onNavigate('Tasks')}
              >
                View all {openTasks.length} tasks
              </button>
            ) : null}
          </section>
          <section className="dashboard-panel dashboard-plan">
            <div className="dashboard-section-heading">
              <h2>Day plan</h2>
              <button type="button" onClick={() => onNavigate('Calendar')}>
                <CalendarDays size={17} />
                Open calendar
              </button>
            </div>
            {todayEvents.length ? (
              <ul className="dashboard-agenda">
                {todayEvents.map((event) => (
                  <li key={event.id}>
                    <time>{event.start}</time>
                    <button
                      type="button"
                      onClick={() => onNavigate('Calendar')}
                    >
                      <strong>{event.title}</strong>
                      <span>
                        {event.end} · {event.type}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dashboard-empty">
                <CalendarDays size={30} strokeWidth={1.5} />
                <strong>No blocks scheduled.</strong>
                <p>Make room for what matters.</p>
              </div>
            )}
          </section>
        </div>
        <div className="dashboard-right">
          <section className="dashboard-panel dashboard-focus">
            <h2>Focus session</h2>
            {reactor}
            <button
              type="button"
              className="dashboard-primary"
              onClick={onToggleFocus}
            >
              <TimerIcon running={focus.running} />
              {focus.running ? 'Pause focus' : 'Start focus'}
            </button>
            <button
              type="button"
              className="dashboard-reset"
              onClick={onResetFocus}
            >
              <RotateCcw size={17} />
              Reset
            </button>
          </section>
          <section className="dashboard-panel dashboard-routines">
            <h2>Routines</h2>
            <ul>
              {routines.map((routine) => (
                <li key={routine.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={routine.done}
                      onChange={() =>
                        onUpdateRoutine(routine.id, { done: !routine.done })
                      }
                    />
                    <span>{routine.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function TimerIcon({ running }) {
  return running ? <Pause size={18} /> : <Play size={18} />;
}
