import subprocess
import os
import requests
import tarfile
import zipfile
from pathlib import Path
import sys

# Create assets directory
assets_dir = Path("assets/kenny-references")
assets_dir.mkdir(exist_ok=True)

# Current Kenny asset pack URLs (direct download from kenney.nl)
kenney_base = "https://kenney.nl/assets"
packs = [
    ("Space Shooter Remastered", "space-shooter-remastered"),
    ("UI Pack", "ui-pack"),
    ("Space Kit", "space-kit"),
    ("Space Shooter Extension", "space-shooter-extension"),
]

print("Downloading Kenny CC0 assets...")
for name, asset_slug in packs:
    url = f"https://kenney.nl/assets/{asset_slug}"
    filepath = assets_dir / f"{asset_slug}.zip"
    
    # Try alternative CDN if direct fails
    if not os.path.exists(filepath):
        print(f"  - Downloading {name} from {url}...")
        try:
            response = requests.get(url, stream=True, timeout=60)
            response.raise_for_status()
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"    ✓ Saved to {filepath}")
        except Exception as e:
            print(f"    ✗ Failed: {e}")
            sys.exit(1)

print("\nExtracting images...")
# Extract images
for filepath in assets_dir.glob("*.zip"):
    print(f"  - Extracting {filepath.name}...")
    try:
        with zipfile.ZipFile(filepath, 'r') as zip_ref:
            zip_ref.extractall(assets_dir)
        print(f"    ✓ Extracted successfully")
    except Exception as e:
        print(f"    ✗ Failed: {e}")
        sys.exit(1)

# Find image files
image_files = list(assets_dir.glob("**/*.{png,jpg,jpeg,gif,svg}"))
print(f"\nFound {len(image_files)} image files:")
for img in sorted(image_files)[:15]:
    print(f"  - {img.relative_to(assets_dir)}")
if len(image_files) > 15:
    print(f"  ...and {len(image_files) - 15} more")

print("\n✓ Kenny assets downloaded and extracted successfully!")
