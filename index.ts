/**
 * SlopJS - A cross-runtime web framework
 * Copyright (c) 2025 Ufuk Furkan Öztürk
 */

import type { BodyInit } from "bun";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// Define route handler types
type RouteHandler = (
  req: SlopRequest,
  res: SlopResponse,
  next: NextFunction,
) => Promise<void> | void;
type ErrorHandler = (
  err: Error,
  req: SlopRequest,
  res: SlopResponse,
  next: NextFunction,
) => Promise<void> | void;
export type NextFunction = (err?: Error) => Promise<void>;

// Define supported HTTP methods
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type HttpBody =
  | string // Text, HTML, XML, etc.
  | Record<string, JsonValue> // Plain JavaScript object (for JSON)
  | FormData // Form data
  | URLSearchParams // URL-encoded form data
  | ArrayBuffer // Binary data
  | Blob // File data
  | ReadableStream // Streaming data
  | null; // Empty body

// Define server types for different platforms
interface BunServer {
  port: number;
  hostname: string;
  stop: () => void;
}

interface NodeServer {
  listen: (port: number, callback?: () => void) => void;
  close: () => void;
}

interface DenoServer {
  shutdown: () => void;
}

type ServerType = BunServer | NodeServer | DenoServer;

// Route interface
interface Route {
  method: HttpMethod;
  path: string;
  handlers: RouteHandler[];
}

// Middleware interface
interface Middleware {
  path: string;
  handler: RouteHandler | ErrorHandler;
}

// Path matching result
interface PathMatchResult {
  matched: boolean;
  params: Record<string, string>;
}

// Request and response types
export interface SlopRequest {
  method: string;
  url: string;
  headers: Headers;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: HttpBody;
}

export interface SlopResponse {
  statusCode: number;
  headers: Headers;
  body: HttpBody;
  status(code: number): SlopResponse;
  send(body: HttpBody): SlopResponse;
  json(data: HttpBody): SlopResponse;
  redirect(status: number | string, url?: string): SlopResponse;
  sendFile(filePath: string): Promise<SlopResponse>;
  end(data?: HttpBody): SlopResponse;
}

class Slop {
  private routes: Route[];
  private middleware: Middleware[];
  private errorHandlers: Middleware[];

  constructor() {
    this.routes = [];
    this.middleware = [];
    this.errorHandlers = [];
  }

  get(path: string, ...handlers: RouteHandler[]): Slop {
    this.addRoute("GET", path, handlers);
    return this;
  }

  post(path: string, ...handlers: RouteHandler[]): Slop {
    this.addRoute("POST", path, handlers);
    return this;
  }

  put(path: string, ...handlers: RouteHandler[]): Slop {
    this.addRoute("PUT", path, handlers);
    return this;
  }

  delete(path: string, ...handlers: RouteHandler[]): Slop {
    this.addRoute("DELETE", path, handlers);
    return this;
  }

  patch(path: string, ...handlers: RouteHandler[]): Slop {
    this.addRoute("PATCH", path, handlers);
    return this;
  }

  // Middleware handler with overloads
  use(handler: RouteHandler | ErrorHandler): Slop;
  use(path: string, ...handlers: (RouteHandler | ErrorHandler)[]): Slop;
  use(
    pathOrHandler: string | RouteHandler | ErrorHandler,
    ...handlers: (RouteHandler | ErrorHandler)[]
  ): Slop {
    let path: string;

    if (typeof pathOrHandler === "function") {
      handlers.unshift(pathOrHandler);
      path = "*";
    } else {
      path = pathOrHandler;
    }

    for (const handler of handlers) {
      // TypeScript doesn't expose parameter count easily, using Function.length
      if (handler.length === 4) {
        // Error handler (err, req, res, next)
        this.errorHandlers.push({ path, handler: handler as ErrorHandler });
      } else {
        this.middleware.push({ path, handler: handler as RouteHandler });
      }
    }

    return this;
  }

  // Sub-router support
  useRouter(path: string, router: Slop): Slop {
    for (const route of router.routes) {
      const fullPath = path === "/" ? route.path : `${path}${route.path}`;
      this.routes.push({ ...route, path: fullPath });
    }

    for (const mw of router.middleware) {
      const fullPath = path === "/" ? mw.path : `${path}${mw.path}`;
      this.middleware.push({ ...mw, path: fullPath });
    }

    return this;
  }

  // Internal route handling
  private addRoute(
    method: HttpMethod,
    path: string,
    handlers: RouteHandler[],
  ): void {
    this.routes.push({ method, path, handlers });
  }

  // Router factory method
  static Router(): Slop {
    return new Slop();
  }

  // Detect runtime environment
  private detectRuntime(): "bun" | "deno" | "node" {
    if (typeof globalThis.Bun !== "undefined") {
      return "bun";
    }

    if (typeof globalThis.Deno !== "undefined") {
      return "deno";
    }

    if (typeof process !== "undefined" && process.versions?.node) {
      return "node";
    }

    throw new Error("Unable to detect runtime environment");
  }

  // Start server with cross-runtime compatibility
  listen(port: number, callback?: (server: ServerType) => void): ServerType {
    const runtime = this.detectRuntime();

    switch (runtime) {
      case "bun":
        return this.listenBun(port, callback);
      case "node":
        return this.listenNode(port, callback);
      case "deno":
        return this.listenDeno(port, callback);
      default:
        throw new Error(`Unsupported runtime: ${runtime}`);
    }
  }

  // Bun server implementation
  private listenBun(
    port: number,
    callback?: (server: BunServer) => void,
  ): BunServer {
    if (typeof globalThis.Bun === "undefined") {
      throw new Error("Bun environment not detected");
    }

    // @ts-expect-error
    const server = Bun.serve({
      port,
      fetch: this.handleRequest.bind(this),
    });

    if (callback) {
      callback(server as BunServer);
    }

    return server as BunServer;
  }

  // Node.js server implementation
  private listenNode(
    port: number,
    callback?: (server: NodeServer) => void,
  ): NodeServer {
    const http = require("node:http");
    // @ts-expect-error namespace not found
    type IncomingMessage = http.IncomingMessage;
    // @ts-expect-error namespace not found
    type ServerResponse = http.ServerResponse;

    const server = http.createServer(
      async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
        // Convert Node's req/res to fetch-style Request object
        const { method, url, headers } = nodeReq;
        const fullUrl = new URL(
          url || "/",
          `http://${headers.host || "localhost"}`,
        );

        // Build Request object
        const request = new Request(fullUrl.toString(), {
          method: method || "GET",
          headers: headers,
          // Handle body streaming for Node.js
          body:
            method && ["POST", "PUT", "PATCH"].includes(method)
              ? nodeReq
              : null,
        });

        // Process through our handler
        const response = await this.handleRequest(request);

        // Send response back through Node's res
        // @ts-ignore
        nodeRes.statusCode = response.status;

        // Copy headers
        // @ts-ignore
        for (const [key, value] of response.headers.entries()) {
          nodeRes.setHeader(key, value);
        }

        // @ts-ignore
        const body = await response.text();
        nodeRes.end(body);
      },
    );

    server.listen(port, () => {
      if (callback) callback(server as NodeServer);
    });

    return server as NodeServer;
  }

  // Deno server implementation
  private listenDeno(
    port: number,
    callback?: (server: DenoServer) => void,
  ): DenoServer {
    if (typeof globalThis.Deno === "undefined") {
      throw new Error("Deno environment not detected");
    }

    const handler = this.handleRequest.bind(this);

    const server = Deno.serve({ port }, handler);

    if (callback) {
      callback(server as DenoServer);
    }

    return server as DenoServer;
  }

  // Unified request handler (works across platforms)
  async handleRequest(request: Request): Promise<Response> {
    // @ts-ignore
    const url = new URL(request.url);
    // @ts-ignore
    const method = request.method as HttpMethod;
    const path = url.pathname;

    // Build Express-like request object
    const req: SlopRequest = {
      // @ts-ignore
      method: request.method,
      // @ts-ignore
      url: request.url,
      // @ts-ignore
      headers: request.headers,
      path,
      params: {},
      query: Object.fromEntries(url.searchParams),
      body: null,
    };

    // Parse request body
    // @ts-ignore
    if (request.body) {
      try {
        // @ts-ignore
        const contentType = request.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          // @ts-ignore
          req.body = <HttpBody>await request.json();
        } else if (contentType?.includes("application/x-www-form-urlencoded")) {
          req.body = Object.fromEntries(
            // @ts-ignore
            new URLSearchParams(await request.text()),
          );
        } else {
          // @ts-ignore
          req.body = await request.text();
        }
      } catch (e) {
        req.body = null;
      }
    }

    // Build Express-like response object
    const res: SlopResponse = {
      statusCode: 200,
      headers: new Headers(),
      body: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(body: HttpBody) {
        this.body = body;
        return this;
      },
      json(data: HttpBody) {
        // @ts-ignore
        this.headers.set("Content-Type", "application/json");
        this.body = JSON.stringify(data);
        return this;
      },
      redirect(status: number | string, url?: string) {
        if (!url) {
          url = status as string;
          status = 302;
        }
        this.statusCode = status as number;
        // @ts-ignore
        this.headers.set("Location", url);
        return this;
      },
      sendFile: async function (filePath: string) {
        const thisSlop = this as unknown as Slop;
        try {
          const runtime =
            thisSlop.detectRuntime?.() ||
            (typeof globalThis.Bun !== "undefined"
              ? "bun"
              : typeof globalThis.Deno !== "undefined"
                ? "deno"
                : "node");

          if (runtime === "bun") {
            // @ts-expect-error - Bun types might not be available
            const file = Bun.file(filePath);
            this.body = await file.text();
            // @ts-ignore
            this.headers.set("Content-Type", file.type);
          } else if (runtime === "deno") {
            const file = await Deno.readFile(filePath);
            this.body = new TextDecoder().decode(file);
            // Set content type based on file extension
            const ext = filePath.split(".").pop()?.toLowerCase() || "";
            const mimeTypes: Record<string, string> = {
              html: "text/html",
              css: "text/css",
              js: "text/javascript",
              json: "application/json",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              gif: "image/gif",
            };
            // @ts-ignore
            this.headers.set("Content-Type", mimeTypes[ext] || "text/plain");
          } else {
            // Node.js
            const fs = require("fs");
            const path = require("path");
            const file = fs.readFileSync(filePath, "utf8");
            this.body = file;
            // Set content type based on file extension
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const mimeTypes: Record<string, string> = {
              html: "text/html",
              css: "text/css",
              js: "text/javascript",
              json: "application/json",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              gif: "image/gif",
            };
            // @ts-ignore
            this.headers.set("Content-Type", mimeTypes[ext] || "text/plain");
          }
        } catch (err) {
          this.statusCode = 404;
          this.body = "File not found";
        }
        return this;
      },
      end(data?: any) {
        if (data !== undefined) this.body = data;
        return this;
      },
    };

    try {
      // Process middleware and routes
      const next: NextFunction = async (err?: Error) => {
        if (err) {
          // Handle errors
          for (const eh of this.errorHandlers) {
            if (eh.path === "*" || path.startsWith(eh.path)) {
              await (eh.handler as ErrorHandler)(err, req, res, () =>
                Promise.resolve(),
              );
              if (res.body !== null) return;
            }
          }
          throw err; // Re-throw if no handler caught it
        }

        // Find and execute matching route
        let matchedRoute: Route | null = null;
        for (const route of this.routes) {
          if (route.method === method) {
            const pathMatch = this.matchPath(path, route.path);
            if (pathMatch.matched) {
              matchedRoute = route;
              req.params = pathMatch.params;
              break;
            }
          }
        }

        if (!matchedRoute) return;

        for (const handler of matchedRoute.handlers) {
          await handler(req, res, next);
          if (res.body !== null) break;
        }
      };

      // Execute middleware
      for (const mw of this.middleware) {
        if (mw.path === "*" || path.startsWith(mw.path)) {
          await (mw.handler as RouteHandler)(req, res, next);
          if (res.body !== null) {
            break;
          }
        }
      }

      // If no middleware set a response, try routes
      if (res.body === null) {
        await next();
      }

      // Return response
      if (res.body === null) {
        return new Response("Not Found", { status: 404 });
      }

      // Inside handleRequest method, before returning the response
      const logStatusColor =
        res.statusCode >= 500
          ? "\x1b[31m"
          : res.statusCode >= 400
            ? "\x1b[33m"
            : res.statusCode >= 300
              ? "\x1b[36m"
              : res.statusCode >= 200
                ? "\x1b[32m"
                : "\x1b[37m";

      console.log(
        `\x1b[1m${method}\x1b[0m ${path} ${logStatusColor}${res.statusCode}\x1b[0m`,
      );

      return new Response(res.body, {
        status: res.statusCode,
        headers: res.headers,
      });
    } catch (err) {
      console.error(err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // Path matching with parameter extraction
  matchPath(actualPath: string, routePath: string): PathMatchResult {
    if (routePath === actualPath) {
      return { matched: true, params: {} };
    }

    const routeParts = routePath.split("/");
    const actualParts = actualPath.split("/");

    if (routeParts.length !== actualParts.length) {
      return { matched: false, params: {} };
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < routeParts.length; i++) {
      // @ts-ignore
      if (routeParts[i].startsWith(":")) {
        // Extract route parameter
        // @ts-ignore
        const paramName = routeParts[i].substring(1);
        // @ts-ignore
        params[paramName] = actualParts[i];
      } else if (routeParts[i] !== actualParts[i]) {
        return { matched: false, params: {} };
      }
    }

    return { matched: true, params };
  }
}

// Support both ESM and CommonJS
export default Slop;

// Add CommonJS compatibility
declare const module: any;
if (typeof module !== "undefined") {
  module.exports = Slop;
}

// Declare runtime globals for TypeScript
declare global {
  namespace globalThis {
    var Bun: unknown | undefined;
    var Deno: unknown | undefined;
  }
}
