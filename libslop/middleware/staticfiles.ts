import type { SlopRequest, SlopResponse, NextFunction } from "../..";

export function staticFiles(directory: string, indexFile = "index.html") {
  // Get absolute path to the directory
  const absDirectory = (() => {
    // Handle relative paths
    if (!directory.startsWith("/")) {
      if (typeof process !== "undefined") {
        // Node.js or Bun
        return `${process.cwd()}/${directory}`;
      } else if (typeof Deno !== "undefined") {
        // Deno
        return `${Deno.cwd()}/${directory}`;
      }
    }
    return directory;
  })();

  console.log(`Serving static files from: ${absDirectory}`);

  return async (req: SlopRequest, res: SlopResponse, next: NextFunction) => {
    // Only handle GET requests
    if (req.method !== "GET") return next();

    // Get the requested path
    let filePath = req.path;

    // If requesting the root, serve the index file
    if (filePath === "/") {
      filePath = `/${indexFile}`;
    }

    // Remove leading slash and resolve path
    filePath = filePath.substring(1);
    const fullPath = `${absDirectory}/${filePath}`;

    console.log(`Attempting to serve: ${fullPath}`);

    try {
      await res.sendFile(fullPath);

      // Check if file was found - if status is 404, call next()
      if (res.statusCode === 404) {
        console.log(`File not found: ${fullPath}`);
        return next();
      }
    } catch (err) {
      console.error(`Static file error: ${err}`);
      next();
    }
  };
}
