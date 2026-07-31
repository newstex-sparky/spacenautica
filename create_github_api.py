#!/usr/bin/env python3
"""Create M4 milestone and issue #47 via GitHub API"""

import subprocess
import sys
import os

GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')

if not GITHUB_TOKEN:
    print("ERROR: GITHUB_TOKEN environment variable not set")
    sys.exit(1)

try:
    # Get GitHub user info to confirm auth
    result = subprocess.run(
        ["gh", "auth", "status"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"gh auth status failed: {result.stderr}")
        sys.exit(1)
    print(f"✓ Authenticated: {result.stdout.strip()}")

    # Read repo details
    with open("/home/newstex/workspace/spacenautica/create_milestone_issue.py", "r") as f:
        py_content = f.read()

    # Execute the Python script inline
    result = subprocess.run(
        [sys.executable, "/home/newstex/workspace/spacenautica/create_milestone_issue.py"],
        capture_output=True,
        text=True,
    )
    
    print(result.stdout)
    if result.stderr:
        print("Stderr:", result.stderr)
    
    sys.exit(result.returncode)

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)