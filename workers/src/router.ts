/**
 * Simple Router utility (optional - not used in current implementation
 * but available for future routing needs)
 */

type Handler = (request: Request, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  private pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexPath = path.replace(/:([^/]+)/g, (_, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    });
    return {
      pattern: new RegExp(`^${regexPath}$`),
      paramNames,
    };
  }

  get(path: string, handler: Handler): void {
    const { pattern, paramNames } = this.pathToRegex(path);
    this.routes.push({ method: 'GET', pattern, paramNames, handler });
  }

  post(path: string, handler: Handler): void {
    const { pattern, paramNames } = this.pathToRegex(path);
    this.routes.push({ method: 'POST', pattern, paramNames, handler });
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== request.method) continue;

      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return route.handler(request, params);
      }
    }

    return null;
  }
}
