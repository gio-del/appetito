I'd like a tiny page on the server that says "hello from appetito", so I can see the whole loop work.

- A service `hello` that serves a static page with that text on 127.0.0.1:8090.
- It runs as its own user, restarts if it crashes, and its health check is the page itself.

Done when the deploy runner's checks pass with the page answering.
