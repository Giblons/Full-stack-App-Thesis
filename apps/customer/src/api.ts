import { createClient } from '@drone/shared/client';

export const client = createClient({
  apiUrl: import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE ?? null,
  dev: import.meta.env.DEV,
});
