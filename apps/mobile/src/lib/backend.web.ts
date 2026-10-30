/**
 * Browser UI preview only: an in-memory backend with sample data replaces
 * Neon (see src/preview/README.md). The native app uses backend.ts.
 */
export { backend, setTokenGetter } from '@/preview/fake-backend';
export { FunctionError } from './function-error';
