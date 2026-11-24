export type ErrorCode =
  | 'DATABASE_INIT_ERROR'
  | 'DATABASE_OPERATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'BACKUP_INVALID_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'SAFETY_GUARD_ERROR'
  | 'UNKNOWN_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: string[];

  constructor(message: string, code: ErrorCode = 'UNKNOWN_ERROR', details?: string[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: string[]) {
    super(message, 'DATABASE_OPERATION_ERROR', details);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: string[]) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class BackupError extends AppError {
  constructor(message: string, details?: string[]) {
    super(message, 'BACKUP_INVALID_ERROR', details);
    this.name = 'BackupError';
  }
}

export class SafetyGuardError extends AppError {
  constructor(message: string, details?: string[]) {
    super(message, 'SAFETY_GUARD_ERROR', details);
    this.name = 'SafetyGuardError';
  }
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected local storage error occurred.';
}
