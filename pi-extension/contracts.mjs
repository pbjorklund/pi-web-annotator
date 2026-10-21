// Generated from pi-extension/contracts.ts; run npm run build:typescript. Do not edit.
export function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function required(value) { if (value === undefined || value === null)
    throw new Error('Missing required annotator value'); return value; }
export function record(value) { if (!object(value))
    throw new Error('Invalid annotator object'); return value; }
