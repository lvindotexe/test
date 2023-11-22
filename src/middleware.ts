import { defineMiddleware } from "astro:middleware";
import { Router } from "./lib";

const app = new Router().use((_, next) => {
    console.log("sfw log running in middleware")
    return next()
})


export const onRequest = defineMiddleware((ctx, next) => app.handle(ctx, next))