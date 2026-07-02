#!/usr/bin/env bash
# Robust detached launcher for the Amplify (Open_Claude) dev server.
# Writes all output to /home/z/my-project/dev.log so the sandbox
# monitoring tooling continues to work.
cd /home/z/open-claude
export NODE_OPTIONS="--max-old-space-size=2048"
node pre-start.cjs
exec pnpm exec remix vite:dev --port 3000 --host 0.0.0.0 --strictPort
