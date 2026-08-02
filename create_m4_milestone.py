import subprocess
import json

# Create new M4 milestone
result = subprocess.run(
    ["gh", "api", "repos", "newstex-sparky", "spacenautica", "milestones"],
    capture_output=True,
    text=True
)
print("List current milestones:")
print(result.stdout[:500])

# Create M4 milestone
result = subprocess.run(
    ["gh", "api", "repos", "newstex-sparky", "spacenautica", "milestones", "-X", "POST"],
    capture_output=True,
    text=True,
    input=json.dumps({
        "title": "M4: Deep Systems",
        "state": "open",
        "description": "Tech tree, shuttle pod, signal relay win condition, distress broadcast sequence. 3D first-person survival base-building game.",
        "due_on": "2026-08-15T00:00:00Z"
    })
)
print("\nCreate M4 milestone response:")
print(result.stdout)