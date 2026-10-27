import { jsonResponse } from "../auth/http";

/** Next.js passed route handlers their URL parameters as a promise; the handlers keep that shape. */
export type RouteContext = { params: Promise<any> };
export type RouteHandler = (request: Request, context: RouteContext) => Response | Promise<Response>;

export interface Route {
  readonly method: "GET" | "POST";
  readonly pattern: string;
  readonly handler: RouteHandler;
}

interface Match {
  readonly route: Route;
  readonly params: Record<string, string | string[]>;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchPattern(pattern: string, pathname: string): Record<string, string | string[]> | undefined {
  const want = pattern.split("/");
  const have = pathname.split("/");
  const params: Record<string, string | string[]> = {};
  for (let i = 0; i < want.length; i += 1) {
    const part = want[i] as string;
    if (part.startsWith("*")) {
      const rest = have.slice(i).filter((segment) => segment !== "");
      if (rest.length === 0) return undefined;
      params[part.slice(1)] = rest.map(decodeSegment);
      return params;
    }
    const actual = have[i];
    if (actual === undefined) return undefined;
    if (part.startsWith(":")) {
      if (actual === "") return undefined;
      params[part.slice(1)] = decodeSegment(actual);
    } else if (part !== actual) {
      return undefined;
    }
  }
  return want.length === have.length ? params : undefined;
}

/** Dispatches a standard `Request` to the first route that matches, answering 404 and 405 itself. */
export function createRouter(routes: readonly Route[]): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url);
    const matches: Match[] = [];
    for (const route of routes) {
      const params = matchPattern(route.pattern, pathname);
      if (params !== undefined) matches.push({ route, params });
    }
    if (matches.length === 0) {
      return jsonResponse({ code: "NOT_FOUND", message: "No such endpoint." }, { status: 404 });
    }
    const match = matches.find((candidate) => candidate.route.method === request.method);
    if (match === undefined) {
      const allow = matches.map((candidate) => candidate.route.method).join(", ");
      return jsonResponse(
        { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
        { status: 405, headers: { Allow: allow } },
      );
    }
    try {
      return await match.route.handler(request, { params: Promise.resolve(match.params) });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "request failed", path: pathname, error: String(error) }));
      return jsonResponse({ code: "INTERNAL", message: "Something went wrong." }, { status: 500 });
    }
  };
}
