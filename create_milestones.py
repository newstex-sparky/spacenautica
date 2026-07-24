#!/usr/bin/env python3
import subprocess
import sys

def run_command(cmd):
    """Run a shell command and return its output"""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        return None
    return result.stdout.strip()

# Create milestones
milestones = [
    {"title": "M1: Core Survival Loop", "due": "2026-08-01T00:00:00Z"},
    {"title": "M2: Station Building", "due": "2026-08-02T00:00:00Z"},
    {"title": "M3: Art Pipeline", "due": "2026-08-03T00:00:00Z"},
    {"title": "M4: Deep Systems", "due": "2026-08-04T00:00:00Z"},
]

print("Creating milestones...")
for milestone in milestones:
    output = run_command(
        f"gh api repos/newstex-sparky/spacenautica/milestones -X POST -f 'title={milestone['title']}' -f 'due_on={milestone['due']}'"
    )
    if output:
        print(f"✓ Created milestone: {milestone['title']}")
    else:
        print(f"✗ Failed milestone: {milestone['title']}")

print("Done!")