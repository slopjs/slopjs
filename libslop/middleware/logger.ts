import type { SlopRequest, SlopResponse, NextFunction } from "../..";

export interface LoggerOptions {
  // Enable/disable colored output
  colors?: boolean;
  // Print request headers
  headers?: boolean;
  // Print request body (when applicable)
  body?: boolean;
  // Custom log function (defaults to console.log)
  logFn?: (message: string) => void;
}

const defaultOptions: LoggerOptions = {
  colors: true,
  headers: true,
  body: true,
  logFn: console.log,
};

/**
 * Format for terminal colors
 */
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

/**
 * Get appropriate color for HTTP status code
 */
function getStatusColor(status: number): string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;
  if (status >= 200) return colors.green;
  return colors.white;
}

/**
 * Format current timestamp
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a logger middleware with the given options
 */
export function logger(
  options: LoggerOptions = {},
): (
  req: SlopRequest,
  res: SlopResponse,
  next: () => Promise<void>,
) => Promise<void> {
  const opts: LoggerOptions = { ...defaultOptions, ...options };

  return async (
    req: SlopRequest,
    res: SlopResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // Create a closure to store request start time
    const startTime = Date.now();

    // Store original methods before overriding
    const originalEnd = res.end;
    const originalSend = res.send;
    const originalJson = res.json;
    const originalStatus = res.status;

    // We'll use this flag to ensure we log only once
    let hasLogged = false;

    // Function to log the complete request/response cycle
    const logComplete = (): void => {
      if (hasLogged) return;
      hasLogged = true;

      const responseTime = Date.now() - startTime;
      const method = req.method;
      const path = req.path;
      const status = res.statusCode;

      // Build the log message with appropriate colors if enabled
      let logMessage = `${getTimestamp()} `;

      if (opts.colors) {
        logMessage += `${colors.bright}${method}${colors.reset} ${path} `;
        logMessage += `${getStatusColor(status)}${status}${colors.reset} `;
        logMessage += `${colors.gray}${responseTime}ms${colors.reset}`;
      } else {
        logMessage += `${method} ${path} ${status} ${responseTime}ms`;
      }

      opts.logFn!(logMessage);

      // Log headers if enabled
      if (opts.headers && req.headers) {
        opts.logFn!(
          `${opts.colors ? colors.dim : ""}Headers:${opts.colors ? colors.reset : ""}`,
        );

        // Convert headers to object if it's not already
        const headers =
          req.headers instanceof Headers
            ? Object.fromEntries(req.headers.entries())
            : req.headers;

        for (const [key, value] of Object.entries(headers)) {
          opts.logFn!(
            `  ${opts.colors ? colors.dim : ""}${key}:${opts.colors ? colors.reset : ""} ${value}`,
          );
        }
      }

      // Log body if enabled and exists
      if (opts.body && req.body) {
        opts.logFn!(
          `${opts.colors ? colors.dim : ""}Body:${opts.colors ? colors.reset : ""}`,
        );
        try {
          const bodyStr =
            typeof req.body === "object"
              ? JSON.stringify(req.body, null, 2)
              : String(req.body);
          opts.logFn!(`  ${bodyStr}`);
        } catch (err: unknown) {
          const error = err as Error;
          opts.logFn!(`  [Unable to stringify body: ${error.message}]`);
        }
      }

      // Add separator for readability
      opts.logFn!("");
    };

    // Override response methods to capture the response before it's sent
    res.send = function (body): SlopResponse {
      logComplete();
      return originalSend.call(this, body);
    };

    res.json = function (body): SlopResponse {
      logComplete();
      return originalJson.call(this, body);
    };

    res.end = function (chunk?: any): SlopResponse {
      logComplete();
      return originalEnd.call(this, chunk);
    };

    res.status = function (code: number): SlopResponse {
      return originalStatus.call(this, code);
    };

    // Continue processing the request
    try {
      await next();
      // If response was not explicitly sent, log it now
      if (!hasLogged && res.body !== undefined) {
        logComplete();
      }
    } catch (err: unknown) {
      // Log errors too
      if (!hasLogged) {
        res.statusCode = 500;
        logComplete();
      }
      throw err;
    } finally {
      // Restore original methods to prevent memory leaks
      res.send = originalSend;
      res.json = originalJson;
      res.end = originalEnd;
      res.status = originalStatus;
    }
  };
}

export default logger;
