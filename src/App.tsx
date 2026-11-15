import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getTaskApi } from "./api/taskApi";
import {
  getSession,
  registerWithTaskFlow,
  signInWithCredentials,
  signOut,
  type AuthSession,
  type RegistrationInput,
} from "./auth/authService";
import type {
  PaginatedTasks,
  Task,
  TaskInput,
  TaskListQuery,
  TaskPriority,
  TaskStatus,
} from "./types";
import "./App.css";

const apiMode = import.meta.env.VITE_API_MODE ?? "mock";
const pageSize = 8;
const emptyTask: TaskInput = {
  title: "",
  description: "",
  assignee: "",
  category: "",
  dueDate: "",
  priority: "Medium",
  status: "Pending",
};
const emptyFilters = {
  search: "",
  status: "",
  priority: "",
  assignee: "",
  dueAfter: "",
  dueBefore: "",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function readPageResult(result: PaginatedTasks) {
  return { tasks: result.tasks, pageInfo: result };
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(apiMode !== "taskflow");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pageInfo, setPageInfo] = useState<PaginatedTasks | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registration, setRegistration] = useState<RegistrationInput>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [query, setQuery] = useState<TaskListQuery>({
    page: 1,
    limit: pageSize,
  });
  const [filters, setFilters] = useState(emptyFilters);
  const [taskDraft, setTaskDraft] = useState<TaskInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const taskApi = getTaskApi(apiMode === "taskflow" ? "taskflow" : "mock");

  const loadTasks = useCallback(async (taskQuery: TaskListQuery) => {
    setLoading(true);
    setError("");
    try {
      const result = readPageResult(await taskApi.list(taskQuery));
      setTasks(result.tasks);
      setPageInfo(result.pageInfo);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [taskApi]);

  useEffect(() => {
    if (apiMode !== "taskflow") return;

    let active = true;
    getSession()
      .then((currentSession) => {
        if (active) setSession(currentSession);
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (active) {
          setSessionChecked(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    if (apiMode === "taskflow" && !session) return;

    let active = true;
    taskApi.list(query)
      .then((result) => {
        if (active) {
          const loaded = readPageResult(result);
          setTasks(loaded.tasks);
          setPageInfo(loaded.pageInfo);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query, session, sessionChecked, taskApi]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery: TaskListQuery = { page: 1, limit: pageSize };
    if (filters.search.trim()) nextQuery.search = filters.search.trim();
    if (filters.status) nextQuery.status = filters.status as TaskStatus;
    if (filters.priority) nextQuery.priority = filters.priority as TaskPriority;
    if (filters.assignee.trim()) nextQuery.assignee = filters.assignee.trim();
    if (filters.dueAfter) nextQuery.dueAfter = filters.dueAfter;
    if (filters.dueBefore) nextQuery.dueBefore = filters.dueBefore;
    setLoading(true);
    setQuery(nextQuery);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setLoading(true);
    setQuery({ page: 1, limit: pageSize });
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      setSession(await signInWithCredentials(email, password));
      setPassword("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setLoading(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (registration.password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }
    if (registration.password !== registration.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const user = await registerWithTaskFlow(registration);
      setEmail(user.email);
      setPassword("");
      setRegistration({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
      });
      setAuthView("login");
      setNotice("Account created. Sign in with your new TaskFlow account.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setError("");
    setLoading(true);
    try {
      await signOut();
      setSession(null);
      setTasks([]);
      setPageInfo(null);
      setLoading(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setLoading(false);
    }
  }

  function openCreateForm() {
    setEditingId(null);
    setTaskDraft({ ...emptyTask });
    setFormError("");
  }

  function openEditForm(task: Task) {
    setEditingId(task.id);
    setTaskDraft({
      title: task.title,
      description: task.description,
      assignee: task.assignee,
      category: task.category,
      dueDate: task.dueDate,
      priority: task.priority,
      status: task.status,
    });
    setFormError("");
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDraft?.title.trim()) {
      setFormError("Enter a task title.");
      return;
    }

    setMutating(true);
    setFormError("");
    try {
      const values = {
        ...taskDraft,
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim(),
        assignee: taskDraft.assignee.trim(),
        category: taskDraft.category.trim(),
      };
      if (editingId) {
        await taskApi.update(editingId, values);
      } else {
        await taskApi.create(values);
      }

      setTaskDraft(null);
      setEditingId(null);
      const nextQuery = !editingId && query.page !== 1
        ? { ...query, page: 1 }
        : query;
      if (nextQuery !== query) {
        setLoading(true);
        setQuery(nextQuery);
      } else {
        await loadTasks(query);
      }
    } catch (requestError) {
      setFormError(getErrorMessage(requestError));
    } finally {
      setMutating(false);
    }
  }

  async function removeTask(task: Task) {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) {
      return;
    }

    setMutating(true);
    setError("");
    try {
      await taskApi.remove(task.id);
      if (query.page > 1 && tasks.length === 1) {
        setLoading(true);
        setQuery((current) => ({ ...current, page: Math.max(1, current.page - 1) }));
      } else {
        await loadTasks(query);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setMutating(false);
    }
  }

  if (apiMode !== "mock" && apiMode !== "taskflow") {
    return (
      <main className="shell">
        <p className="notice error">VITE_API_MODE must be mock or taskflow.</p>
      </main>
    );
  }

  if (apiMode === "taskflow" && !sessionChecked) {
    return (
      <main className="shell">
        <p className="notice" role="status">Checking your TaskFlow session…</p>
      </main>
    );
  }

  if (apiMode === "taskflow" && !session) {
    return (
      <main className="shell">
        <header className="topbar">
          <div className="brand-mark">TF</div>
          <div className="brand-copy">
            <p className="eyebrow">CLASSROOM INTEGRATION POC</p>
            <h1>TaskFlow React</h1>
          </div>
          <span className="mode-badge taskflow">TASKFLOW API</span>
        </header>
        <section className="panel login-panel">
          {authView === "login" ? (
            <>
              <p className="eyebrow">AUTHENTICATE WITH TASKFLOW</p>
              <h2>Sign in</h2>
              <p className="muted">
                Use your TaskFlow account. Credentials are sent to Auth.js through
                the same-origin TaskFlow API proxy.
              </p>
              <form onSubmit={handleLogin} className="form">
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={loading}>
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setAuthView("register");
                  setError("");
                }}
              >
                Create a student account
              </button>
            </>
          ) : (
            <>
              <p className="eyebrow">JOIN TASKFLOW</p>
              <h2>Create a student account</h2>
              <p className="muted">
                Your account is created by TaskFlow. Passwords are validated and
                hashed on the server.
              </p>
              <form onSubmit={handleRegister} className="form">
                <label>
                  Full name
                  <input
                    autoComplete="name"
                    value={registration.name}
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={registration.email}
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Password (12 characters minimum)
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={registration.password}
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={registration.confirmPassword}
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        confirmPassword: event.target.value,
                      }))
                    }
                    maxLength={128}
                    required
                  />
                </label>
                <button type="submit" disabled={loading}>
                  {loading ? "Creating account..." : "Register"}
                </button>
              </form>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setAuthView("login");
                  setError("");
                }}
              >
                Back to sign in
              </button>
            </>
          )}
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">TF</div>
        <div className="brand-copy">
          <p className="eyebrow">CLASSROOM INTEGRATION POC</p>
          <h1>TaskFlow React</h1>
        </div>
        <div className="header-actions">
          <span className={`mode-badge ${apiMode}`}>
            {apiMode === "mock" ? "JSON SERVER" : "TASKFLOW API"}
          </span>
          {apiMode === "taskflow" && session && (
            <>
              <span className="signed-in">
                {session.user?.name ?? session.user?.email}
              </span>
              <button
                className="button-secondary"
                onClick={() => void handleLogout()}
                disabled={loading}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">YOUR TASKS</p>
          <h2>One API, shared task records</h2>
          <p className="muted">
            {apiMode === "mock"
              ? "Mock mode reads and writes the classroom JSON Server."
              : "TaskFlow mode uses your authenticated account and the shared TaskFlow API."}
          </p>
        </div>
        <button
          className="button-secondary"
          onClick={() => void loadTasks(query)}
          disabled={loading}
        >
          Refresh tasks
        </button>
      </section>

      <form className="filters panel" onSubmit={applyFilters}>
        <label>
          Search title and description
          <input
            type="search"
            value={filters.search}
            maxLength={200}
            onChange={(event) =>
              setFilters((current) => ({ ...current, search: event.target.value }))
            }
            placeholder="Search tasks"
          />
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="">All statuses</option>
            <option>Pending</option>
            <option>In Progress</option>
            <option>Completed</option>
          </select>
        </label>
        <label>
          Priority
          <select
            value={filters.priority}
            onChange={(event) =>
              setFilters((current) => ({ ...current, priority: event.target.value }))
            }
          >
            <option value="">All priorities</option>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
        </label>
        <label>
          Assignee
          <input
            value={filters.assignee}
            maxLength={120}
            onChange={(event) =>
              setFilters((current) => ({ ...current, assignee: event.target.value }))
            }
            placeholder="Filter by assignee"
          />
        </label>
        <label>
          Due on or after
          <input
            type="date"
            value={filters.dueAfter}
            onChange={(event) =>
              setFilters((current) => ({ ...current, dueAfter: event.target.value }))
            }
          />
        </label>
        <label>
          Due on or before
          <input
            type="date"
            value={filters.dueBefore}
            onChange={(event) =>
              setFilters((current) => ({ ...current, dueBefore: event.target.value }))
            }
          />
        </label>
        <div className="filter-actions">
          <button type="submit" disabled={loading}>Apply filters</button>
          <button
            type="button"
            className="button-secondary"
            onClick={clearFilters}
            disabled={loading}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={openCreateForm}
            disabled={loading || mutating}
          >
            Add task
          </button>
        </div>
      </form>

      {taskDraft && (
        <form className="task-editor panel" onSubmit={saveTask}>
          <h2>{editingId ? "Edit task" : "Create task"}</h2>
          <div className="editor-grid">
            <label>
              Title
              <input
                value={taskDraft.title}
                maxLength={200}
                onChange={(event) =>
                  setTaskDraft((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                required
              />
            </label>
            <label>
              Assignee
              <input
                value={taskDraft.assignee}
                maxLength={120}
                onChange={(event) =>
                  setTaskDraft((current) =>
                    current ? { ...current, assignee: event.target.value } : current,
                  )
                }
              />
            </label>
            <label>
              Category
              <input
                value={taskDraft.category}
                maxLength={100}
                onChange={(event) =>
                  setTaskDraft((current) =>
                    current ? { ...current, category: event.target.value } : current,
                  )
                }
              />
            </label>
            <label>
              Priority
              <select
                value={taskDraft.priority}
                onChange={(event) =>
                  setTaskDraft((current) =>
                    current
                      ? { ...current, priority: event.target.value as TaskPriority }
                      : current,
                  )
                }
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={taskDraft.status}
                onChange={(event) =>
                  setTaskDraft((current) =>
                    current
                      ? { ...current, status: event.target.value as TaskStatus }
                      : current,
                  )
                }
              >
                <option>Pending</option>
                <option>In Progress</option>
                <option>Completed</option>
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={taskDraft.dueDate}
                onChange={(event) =>
                  setTaskDraft((current) =>
                    current ? { ...current, dueDate: event.target.value } : current,
                  )
                }
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              rows={3}
              value={taskDraft.description}
              maxLength={5000}
              onChange={(event) =>
                setTaskDraft((current) =>
                  current ? { ...current, description: event.target.value } : current,
                )
              }
            />
          </label>
          {formError && <p className="notice error" role="alert">{formError}</p>}
          <div className="filter-actions">
            <button type="submit" disabled={mutating}>
              {mutating ? "Saving..." : "Save task"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setTaskDraft(null);
                setEditingId(null);
                setFormError("");
              }}
              disabled={mutating}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {loading && <p className="notice" role="status">Loading tasks...</p>}
      {!loading && !error && tasks.length === 0 && (
        <p className="notice">No tasks match these filters.</p>
      )}

      <section className="task-list" aria-label="Task list">
        {tasks.map((task) => (
          <article className="task-card" key={task.id}>
            <div className="task-heading">
              <span className={`status-dot ${task.status.toLowerCase().replaceAll(" ", "-")}`} />
              <span className="task-category">{task.category || "Uncategorized"}</span>
              <span className={`priority ${task.priority.toLowerCase()}`}>
                {task.priority}
              </span>
            </div>
            <h3>{task.title}</h3>
            <p className="task-description">
              {task.description || "No description provided."}
            </p>
            <div className="task-meta">
              <span>{task.assignee || "Unassigned"}</span>
              <span>{task.dueDate || "No due date"}</span>
              <span>{task.status}</span>
            </div>
            <div className="task-actions">
              <button
                className="text-button"
                onClick={() => openEditForm(task)}
                disabled={mutating}
              >
                Edit
              </button>
              <button
                className="text-button danger"
                onClick={() => void removeTask(task)}
                disabled={mutating}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </section>

      {pageInfo && pageInfo.totalPages > 0 && (
        <nav className="pagination" aria-label="Task list pages">
          <span>
            {pageInfo.total} tasks · Page {pageInfo.page} of {pageInfo.totalPages}
          </span>
          <div>
            <button
              className="button-secondary"
              onClick={() => {
                setLoading(true);
                setQuery((current) => ({ ...current, page: current.page - 1 }));
              }}
              disabled={loading || pageInfo.page <= 1}
            >
              Previous
            </button>
            <button
              className="button-secondary"
              onClick={() => {
                setLoading(true);
                setQuery((current) => ({ ...current, page: current.page + 1 }));
              }}
              disabled={loading || pageInfo.page >= pageInfo.totalPages}
            >
              Next
            </button>
          </div>
        </nav>
      )}

      {apiMode === "taskflow" && (
        <p className="footnote">
          Changes persist in TaskFlow. Refresh its dashboard to see updates; this
          proof of concept does not use realtime events.
        </p>
      )}
    </main>
  );
}

export default App;
