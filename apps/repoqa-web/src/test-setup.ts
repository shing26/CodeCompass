import '@testing-library/jest-dom/vitest';

// CI runners are slow: raise the default async utility timeout (waitFor etc.)
// from 1s to 8s so timing assertions do not flake on cold machines.
import { configure } from '@testing-library/dom';
configure({ asyncUtilTimeout: 8000 });
