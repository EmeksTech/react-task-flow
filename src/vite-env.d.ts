/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: "mock" | "taskflow";
  readonly VITE_MOCK_API_BASE_URL?: string;
  readonly VITE_TASKFLOW_CALLBACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
