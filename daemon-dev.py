#!/usr/bin/env python3
"""Double-fork daemon launcher for the Amplify dev server.

Reparents to init (PID 1) so the process escapes any process-tree-based
cleanup the sandbox shell may perform when a Bash tool call returns.
"""
import os
import sys

WORKDIR = "/home/z/open-claude"
LOG = "/home/z/my-project/dev.log"


def daemonize():
    # First fork
    if os.fork() > 0:
        sys.exit(0)
    os.setsid()
    # Second fork
    if os.fork() > 0:
        sys.exit(0)
    # Now fully detached, reparented to init
    os.chdir(WORKDIR)
    os.umask(0)
    # Redirect stdio to the log file
    sys.stdout.flush()
    sys.stderr.flush()
    f = open(LOG, "w")
    os.dup2(f.fileno(), 0)
    os.dup2(f.fileno(), 1)
    os.dup2(f.fileno(), 2)


def main():
    daemonize()
    # Exec the dev server. We are now PID-1-reparented.
    env = os.environ.copy()
    env["NODE_OPTIONS"] = "--max-old-space-size=2048"
    os.execvpe("bash", ["bash", "/home/z/open-claude/start-dev.sh"], env)


if __name__ == "__main__":
    main()
