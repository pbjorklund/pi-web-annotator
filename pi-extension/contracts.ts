export type JobStatus = 'pending' | 'sending' | 'sent' | 'in_progress' | 'completed';
export type AnnotationJob = {id: string; prompt: string; annotationIds: string[]};
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function required<T>(value: T): NonNullable<T> { if (value === undefined || value === null) throw new Error('Missing required annotator value'); return value; }
export function record(value: unknown): Record<string, unknown> { if (!object(value)) throw new Error('Invalid annotator object'); return value; }
