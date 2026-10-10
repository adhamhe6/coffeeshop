import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node (Vitest) MSW server. Individual tests override with `server.use(...)`. */
export const server = setupServer(...handlers);
