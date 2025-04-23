import type { SlopRequest, SlopResponse, NextFunction } from "../..";

export function staticFiles(
  directory: string,
  options: {
    indexFile?: string;
    spaMode?: boolean;
  } = {},
) {
  const { indexFile = "index.html", spaMode = false } = options;

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

  console.log(
    `Serving static files from: ${absDirectory} (SPA mode: ${spaMode})`,
  );

  return async (req: SlopRequest, res: SlopResponse, next: NextFunction) => {
    // Only handle GET requests
    if (req.method !== "GET") return next();

    // Get the requested path
    let filePath = req.path;

    // If requesting the root, serve the index file
    if (filePath === "/") {
      filePath = `/${indexFile}`;
    }

    // Remove leading slash for file path resolution
    const cleanPath = filePath.substring(1);

    // Normalize paths to avoid double slashes
    const normalizePath = (path: string) => {
      return path.replace(/\/+/g, "/");
    };

    // Try different path strategies in order
    const pathsToTry = [
      // 1. Direct file match
      normalizePath(`${absDirectory}/${cleanPath}`),

      // 2. For paths without extensions, try as directory with index file
      ...(!/\.\w+$/.test(cleanPath)
        ? [
            // Add index.html, ensuring no double slashes
            normalizePath(
              `${absDirectory}/${cleanPath}${cleanPath.endsWith("/") ? "" : "/"}${indexFile}`,
            ),
          ]
        : []),

      // 3. SPA fallback (only if enabled and not an asset request)
      ...(spaMode &&
      !cleanPath.match(
        /\.(js|css|png|jpg|jpeg|gif|ico|svg|json|woff|woff2|ttf|eot)$/i,
      )
        ? [normalizePath(`${absDirectory}/${indexFile}`)]
        : []),
    ];

    // Try each path until one works
    for (const pathToTry of pathsToTry) {
      console.log(`Attempting to serve: ${pathToTry}`);

      try {
        await res.sendFile(pathToTry);

        // If successful (not 404), we're done
        if (res.statusCode !== 404) {
          return;
        }
      } catch (err) {
        // Continue to next path on error
        console.log(`Error serving ${pathToTry}: ${err.message}`);
      }
    }

    // If we get here, none of our path strategies worked
    console.log(`No static file found for: ${filePath}`);
    return next();
  };
}
