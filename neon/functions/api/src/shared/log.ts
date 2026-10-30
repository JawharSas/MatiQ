/**
 * Structured JSON logger with secret redaction.
 *
 * Logs end up in Neon's branch logs, so anything that looks like a
 * credential is masked before it is written - even if a developer
 * accidentally logs a request body or an upstream error message.
 */

const REDACTIONS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [/"(apiKey|api_key|password|ciphertext|authorization)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"'],
];

export function redact(input: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: Level, message: string, fields: Record<string, unknown> = {}) => {
    const normalized = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value instanceof Error ? serializeError(value) : value]),
    );
    const line = redact(JSON.stringify({ level, message, time: new Date().toISOString(), ...base, ...normalized }));
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}
