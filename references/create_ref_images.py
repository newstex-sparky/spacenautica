#!/usr/bin/env python3
from PIL import Image, ImageDraw
import random

# Create asteroid reference image (rocky)
img = Image.new('RGB', (512, 512), '#1a1a2e')
draw = ImageDraw.Draw(img)
for _ in range(30):
    x = random.randint(50, 460)
    y = random.randint(50, 460)
    r = random.randint(10, 40)
    color = random.choice(['#3d3d3d', '#5c5c5c', '#2d2d2d'])
    draw.ellipse([x-r, y-r, x+r, y+r], fill=color, outline='#1a1a2e')
for _ in range(100):
    x = random.randint(20, 490)
    y = random.randint(20, 490)
    draw.rectangle([x, y, x+3, y+3], fill=random.choice(['#4a4a4a', '#3a3a3a', '#2a2a2a']))
img.save('kenny-asteroid.png')
print("✓ kenny-asteroid.png created")

# Create station module reference image
img = Image.new('RGB', (512, 512), '#0f0f23')
draw = ImageDraw.Draw(img)
draw.rectangle([180, 180, 330, 330], fill='#1a1a40', outline='#0a0a20', width=4)
draw.rectangle([160, 160, 190, 190], fill='#1f1f50', outline='#0a0a20')
draw.rectangle([320, 160, 350, 190], fill='#1f1f50', outline='#0a0a20')
draw.rectangle([160, 320, 190, 350], fill='#1f1f50', outline='#0a0a20')
draw.rectangle([320, 320, 350, 350], fill='#1f1f50', outline='#0a0a20')
draw.ellipse([220, 240, 230, 250], fill='#00ff88', outline='#00ff88')
draw.ellipse([290, 240, 300, 250], fill='#00ff88', outline='#00ff88')
draw.ellipse([220, 230, 310, 260], fill='#2a2a60', outline='#00ff88', width=2)
img.save('kenny-station.png')
print("✓ kenny-station.png created")

# Create tool reference image (mining drill)
img = Image.new('RGB', (512, 512), '#0f0f23')
draw = ImageDraw.Draw(img)
draw.ellipse([180, 200, 330, 310], fill='#2a2a2a', outline='#3a3a3a', width=6)
for i in range(3):
    angle = i * 120
    x1 = 233 + 80 * (1 if i == 0 else (-0.5 if i == 1 else 0.5))
    y1 = 255 - 80 * (1 if i == 1 else (-0.5 if i == 2 else 0.5))
    x2 = x1 + 40
    y2 = y1 + 80
    draw.polygon([233, 255, x1, y1, x2, y2], fill='#1a1a1a', outline='#4a4a4a')
draw.rectangle([220, 160, 245, 180], fill='#3a3a3a', outline='#4a4a4a')
draw.rectangle([267, 160, 292, 180], fill='#3a3a3a', outline='#4a4a4a')
draw.ellipse([230, 350, 240, 360], fill='#ff3333', outline='#ff4444')
draw.ellipse([280, 350, 290, 360], fill='#33ff33', outline='#44ff44')
draw.ellipse([305, 350, 315, 360], fill='#ffff33', outline='#ffff44')
img.save('kenny-tool.png')
print("✓ kenny-tool.png created")

print("\n✅ All reference images created!")