import { requestJson, requestVoid } from "./http";
import type {
  PaginatedTasks,
  Task,
  TaskInput,
  TaskListQuery,
} from "../types";

export interface TaskApi {
  list(query: TaskListQuery): Promise<PaginatedTasks>;
  get(id: string): Promise<Task>;
  create(task: TaskInput): Promise<Task>;
  update(id: string, changes: Partial<TaskInput>): Promise<Task>;
  remove(id: string): Promise<void>;
}

const mockBaseUrl = (
  import.meta.env.VITE_MOCK_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

const mockTaskApi: TaskApi = {
  async list(query) {
    const tasks = await requestJson<Task[]>(`${mockBaseUrl}/tasks`);
    const search = query.search?.trim().toLocaleLowerCase();
    const assignee = query.assignee?.trim().toLocaleLowerCase();
    const filtered = tasks.filter((task) => {
      if (
        search &&
        !task.title.toLocaleLowerCase().includes(search) &&
        !task.description.toLocaleLowerCase().includes(search)
      ) {
        return false;
      }
      if (query.status && task.status !== query.status) return false;
      if (query.priority && task.priority !== query.priority) return false;
      if (
        assignee &&
        !task.assignee.toLocaleLowerCase().includes(assignee)
      ) {
        return false;
      }
      if (query.dueAfter && (!task.dueDate || task.dueDate < query.dueAfter)) {
        return false;
      }
      if (
        query.dueBefore &&
        (!task.dueDate || task.dueDate > query.dueBefore)
      ) {
        return false;
      }
      return true;
    });

    return {
      tasks: filtered.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / query.limit),
    };
  },
  get: (id) => requestJson<Task>(`${mockBaseUrl}/tasks/${encodeURIComponent(id)}`),
  create: (task) =>
    requestJson<Task>(`${mockBaseUrl}/tasks`, {
      method: "POST",
      body: JSON.stringify(task),
    }),
  update: (id, changes) =>
    requestJson<Task>(`${mockBaseUrl}/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  remove: (id) =>
    requestVoid(`${mockBaseUrl}/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

const taskFlowTaskApi: TaskApi = {
  list(query) {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    });
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, String(value));
    }

    return requestJson<PaginatedTasks>(`/api/tasks?${params.toString()}`);
  },
  get: (id) => requestJson<Task>(`/api/tasks/${encodeURIComponent(id)}`),
  create: (task) =>
    requestJson<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(task),
    }),
  update: (id, changes) =>
    requestJson<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  remove: (id) =>
    requestVoid(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export function getTaskApi(mode: string): TaskApi {
  if (mode === "mock") return mockTaskApi;
  if (mode === "taskflow") return taskFlowTaskApi;
  throw new Error('VITE_API_MODE must be either "mock" or "taskflow".');
}
