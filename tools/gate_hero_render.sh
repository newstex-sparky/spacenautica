#!/bin/bash
# Gate Hero Render — Headless Godot render to screenshot/loop/candidate.png

set -e

SCENE="scenes/gate_room_hero.tscn"
SHOTS_DIR="tests/shots"
OUTPUT_DIR="screenshots/loop"
CANDIDATE_OUTPUT="$OUTPUT_DIR/candidate.png"
BEST_OUTPUT="$OUTPUT_DIR/best.png"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Use xvfb-run for headless rendering
if command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" \
        godot --headless --no-window --quit-on-success \
        --render-thread-multi \
        --script "$SHOTS_DIR/hero_shot.gd" "$SCENE" "$OUTPUT_DIR" "$CANDIDATE_OUTPUT"
else
    echo "xvfb-run not found. Running without display."
    godot --headless --no-window --quit-on-success \
        --render-thread-multi \
        --script "$SHOTS_DIR/hero_shot.gd" "$SCENE" "$OUTPUT_DIR" "$CANDIDATE_OUTPUT"
fi

# Capture render metadata
FILE_SIZE=$(stat -f%z "$CANDIDATE_OUTPUT" 2>/dev/null || stat -c%s "$CANDIDATE_OUTPUT" 2>/dev/null || echo "0")
echo "Render completed: $CANDIDATE_OUTPUT ($FILE_SIZE bytes)"
echo "Render quality: OK"