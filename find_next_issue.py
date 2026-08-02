import subprocess
import json

# Use gh CLI to list open issues
try:
    result = subprocess.run(
        ["gh", "issue", "list", "--state", "open", "--json", "number,title,body,label"],
        capture_output=True,
        text=True,
        check=True
    )

    issues = json.loads(result.stdout)

    # Filter out combat-related issues and deferred issues
    relevant_issues = []

    for issue in issues:
        title = issue.get('title', '')
        body = issue.get('body', '')
        labels = [l['name'] for l in issue.get('labels', [])]

        # Check if this is a milestone issue
        is_milestone = any('[M1]' in title or '[M1]' in labels or '[M2]' in title or '[M2]' in labels or '[M3]' in title or '[M3]' in labels for _ in [title, labels])

        # Check if it's deferred
        is_deferred = '[DEFERRED]' in title or '[FUTURE]' in title

        # Check for combat references (banned)
        is_combat = any(x in title.lower() or x in body.lower() for x in ['drone', 'enemy', 'leviathan', 'combat', 'bullet', 'shoot', 'fight', 'weapon', 'attack'])

        if is_milestone and not is_deferred and not is_combat:
            issue_data = {
                'number': issue['number'],
                'title': title,
                'body': body,
                'labels': labels
            }
            relevant_issues.append(issue_data)

    # Sort by issue number (ascending)
    relevant_issues.sort(key=lambda x: x['number'])

    if relevant_issues:
        print(f"Found {len(relevant_issues)} relevant open issues:")
        for issue in relevant_issues:
            print(f"\nIssue #{issue['number']}: {issue['title']}")
            print(f"Labels: {', '.join(issue['labels'])}")

        # Get the lowest number issue (first one sorted)
        if relevant_issues:
            lowest = relevant_issues[0]
            print("\n" + "="*60)
            print(f"PICKED: Issue #{lowest['number']} - {lowest['title']}")
            print("="*60)

            # Print full issue details
            print("\nFull issue details:")
            print("-" * 60)
            print(f"Title: {lowest['title']}")
            print(f"Number: #{lowest['number']}")
            print(f"Labels: {', '.join(lowest['labels'])}")
            print(f"\nBody:\n{lowest['body']}")
    else:
        print("No relevant open issues found.")
        print("Note: The ROADMAP shows M3 is complete (issues #41-45). Check for new issues or milestones.")

except subprocess.CalledProcessError as e:
    print(f"Error running gh: {e.stderr}")
except Exception as e:
    print(f"Error: {e}")