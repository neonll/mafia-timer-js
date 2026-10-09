import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-unmounts when test globals are enabled; do it explicitly.
afterEach(() => {
  cleanup();
});
