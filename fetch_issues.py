#!/usr/bin/env python3
"""Fetch open issues from Spacenautica GitHub repo"""
import os
import sys
import json

token = os.getenv("GITHUB_TOKEN")
if not token:
    print("ERROR: GITHUB_TOKEN environment variable not set")
    sys.exit(1)

owner = "newstex-sparky"
repo = "spacenautica"

url = f"https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=100"
headers = {
    "Authorization": f"token {token}",
    "Accept": "application/vnd.github.v3+json"
}

import urllib.request
request = urllib.request.Request(url, headers=headers)

try:
    with urllib.request.urlopen(request) as response:
        data = json.loads(response.read().decode())
        print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error fetching issues: {e}")
    sys.exit(1)