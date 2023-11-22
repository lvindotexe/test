import type {
    EndpointOutput,
    MiddlewareResponseHandler,
    MiddlewareEndpointHandler
} from 'astro';

type Method = 'POST' | 'GET';

type APIContext = Parameters<MiddlewareEndpointHandler>[0]
type MiddlewareNext = Parameters<MiddlewareEndpointHandler>[1]

type Context<Decorators extends Record<string, unknown>, State extends Record<string, unknown>> = Parameters<MiddlewareResponseHandler>[0] & { decorators: Decorators } & { state: State };
export type Handler<Decorators extends Record<string, unknown> = any, State extends Record<string, unknown> = any> = (
    context: Context<Decorators, State>,
    next: MiddlewareNext,
) => ReturnType<MiddlewareEndpointHandler>;

class Node {
    children: Map<string, Node>;
    isEnd: boolean;
    handlers: Map<Method, Handler<any, any>>;
    subRoute: Router<any, any> | null

    constructor() {
        this.children = new Map();
        this.isEnd = false;
        this.subRoute = null
        this.handlers = new Map();
    }
}


export class Router<Decorators extends Record<string, unknown> = {}, State extends Record<string, unknown> = {}> {
    #root: Node;
    #decorators: Decorators
    #middleware: Array<Handler<any, any>>
    #initialisers: Array<() => State> = new Array()

    constructor() {
        this.#root = new Node();
        this.#decorators = {} as Decorators
        this.#initialisers = new Array()
        this.#middleware = new Array()
    }

    #insertHandler(path: string, method: Method, handler: Handler<Decorators, State>) {
        let node = this.#root;
        const parts = path.split('/').filter(Boolean);

        for (const part of parts) {
            if (!node.children.has(part)) {
                node.children.set(part, new Node());
            }
            node = node.children.get(part)!;
        }

        node.isEnd = true;
        node.handlers.set(method.toLowerCase() as Method, handler);
    }

    #find(path: string) {
        let node = this.#root;
        const parts = path.split('/').filter(Boolean);

        for (const [i] of parts.entries()) {
            if (!node.children.get(parts[i])) break;
            node = node.children.get(parts[i])!;
        }
        return node;
    }

    decorate<NewDecorators extends Record<string, unknown>>(decorator: NewDecorators): Router<Decorators & NewDecorators, State> {
        this.#decorators = { ...this.#decorators, ...decorator }
        return this as Router<Decorators & NewDecorators, State>
    }

    state<NewState extends Record<string, unknown>>(initialiser: () => NewState): Router<Decorators, State & NewState> {
        this.#initialisers.push(initialiser as () => (NewState & State))
        return this as Router<Decorators, State & NewState>
    }

    use(handler: Handler<Decorators, State>) {
        this.#middleware.push(handler)
        return this
    }

    register(subRoute: Router<any, any>, path: string = '/') {
        if (path === '/') {
            this.#decorators = { ...this.#decorators, ...subRoute.#decorators }; // Merge decorators
            for (const initialiser of subRoute.#initialisers) this.#initialisers.push(initialiser)
            for (const middleware of subRoute.#middleware) this.#middleware.push(middleware)
            for (const { path: subPath, method, handler } of subRoute) {
                this.#insertHandler(subPath, method, handler);
            }
            return this
        }
        else {
            let node = this.#root;
            const parts = path.split('/').filter(Boolean);

            for (const part of parts) {
                if (!node.children.has(part)) {
                    node.children.set(part, new Node());
                }
                node = node.children.get(part)!;
            }
            node.subRoute = subRoute;
            return this;
        }
    }

    handle(context: APIContext, next: MiddlewareNext): void | Response | EndpointOutput | Promise<void> | Promise<Response | EndpointOutput> {
        const path = context.url.pathname;
        const node = this.#find(path);
        if (node.subRoute) return node.subRoute.handle(context, next)
        const handler = node.isEnd
            ? node.handlers.get(context.request.method.toLowerCase() as Method)
            : null;
        //@ts-expect-error slutty mutation
        context['state'] = this.#initialisers.reduce((acc, curr) => ({ ...acc, ...curr() }), {})
        //@ts-expect-error slutty mutation
        context['decorators'] = this.#decorators
        // const result = handler ? await handler(context as Context<Decorators, State>, next) : null
        if (handler) {
            this.#middleware.push(handler);
        }

        const length = this.#middleware.length
        if (length === 0) return next()
        const middleware = this.#middleware
        function applyHandle(i: number, handleContext: Context<Decorators, State>) {
            const handle = middleware[i]
            // @ts-expect-error
            // SAFETY: Usually `next` always returns something in user land, but in `sequence` we are actually
            // doing a loop over all the `next` functions, and eventually we call the last `next` that returns the `Response`.
            const result = handle(handleContext, async () => {
                if (i < length - 1) {
                    return applyHandle(i + 1, handleContext);
                } else {
                    return next();
                }
            });
            return result
        }
        return applyHandle(0, context as Context<Decorators, State>)
    }

    //TODO iterate over subroutes aswell
    *[Symbol.iterator]() {
        function* search(
            node: Node,
            fullPath: string,
        ): Iterable<{
            path: string;
            method: Method;
            handler: Handler<Decorators, State>;
        }> {
            for (const [path] of node.children) {
                yield* search(node.children.get(path)!, fullPath.concat(`/${path}`));
            }
            if (node.isEnd) {
                for (const [method, handler] of node.handlers) {
                    yield { path: fullPath, method, handler };
                }
            }
        }
        yield* search(this.#root, '');
    }

    get(path: string, handler: Handler<Decorators, State>) {
        this.#insertHandler(path, 'GET', handler);
        return this;
    }

    post(path: string, handler: Handler<Decorators, State>) {
        this.#insertHandler(path, 'POST', handler);
        return this;
    }
}