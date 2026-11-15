export type TaskStatus = "Pending" | "In Progress" | "Completed";
export type TaskPriority = "Low" | "Medium" | "High";

export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string;
  category: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
}

export type TaskInput = Omit<Task, "id">;

export interface TaskListQuery {
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  dueAfter?: string;
  dueBefore?: string;
  page: number;
  limit: number;
}

export interface PaginatedTasks {
  tasks: Task[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
