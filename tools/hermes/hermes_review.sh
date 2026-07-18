#!/bin/bash
# Gate-hero-review.sh — 3-agent Ollama reviewer panel
# Each profile uses a different model + lens. Returns JSON with VERDICT, closer, scores, gap.

set -e

TARGET="${1:-target}"
BEST="${2:-best}"
CANDIDATE="${3:-candidate}"

REVIEWER_PROFILES=("gd-qa-1" "gd-qa-2" "gd-qa-3")
VALID_COUNT=0
ACCEPT_COUNT=0
REJECT_COUNT=0
TOTAL_SCORE=0
CLOSEST_COUNT=0

echo "=== Gate-Room Hero Review Panel ==="
echo "Target: $TARGET"
echo "Best: $BEST"
echo "Candidate: $CANDIDATE"
echo ""

# First, fetch actual best score by rendering best.png
echo "Fetching best candidate score..."
RENDER_OUTPUT=$(bash tools/gate_hero_render.sh 2>&1 | grep -oP 'Score:\s*\K[\d.]+' || echo "0")

# Run reviewers
for PROFILE in "${REVIEWER_PROFILES[@]}"; do
    echo "--- Reviewer: $PROFILE ---"
    
    # Get best score for reference
    BEST_SCORE=${RENDER_OUTPUT:-0}
    
    # Run hermes with the profile
    if hermes --profile "$PROFILE" agent-browser "Run hermes_review.sh $TARGET $BEST $CANDIDATE" > /tmp/review_$PROFILE.json 2>&1; then
        VERDICT=$(jq -r '.VERDICT // empty' /tmp/review_$PROFILE.json)
        CAND_SCORE=$(jq -r '.cand_score // 0' /tmp/review_$PROFILE.json)
        BEST_SCORE=$(jq -r '.best_score // 0' /tmp/review_$PROFILE.json)
        CLOSER=$(jq -r '.closer // false' /tmp/review_$PROFILE.json)
        GAP=$(jq -r '.gap // "No gap text available"' /tmp/review_$PROFILE.json)
        
        echo "VERDICT: $VERDICT"
        echo "cand_score: $CAND_SCORE"
        echo "best_score: $BEST_SCORE"
        echo "closer: $CLOSER"
        echo "gap: $GAP"
        
        VALID_COUNT=$((VALID_COUNT + 1))
        
        if [ "$VERDICT" = "ACCEPT" ]; then
            ACCEPT_COUNT=$((ACCEPT_COUNT + 1))
        else
            REJECT_COUNT=$((REJECT_COUNT + 1))
        fi
        
        if [ "$CLOSER" = "true" ]; then
            CLOSEST_COUNT=$((CLOSEST_COUNT + 1))
        fi
        
        TOTAL_SCORE=$((TOTAL_SCORE + CAND_SCORE))
        
        echo ">> Profile $PROFILE completed successfully"
    else
        echo "!! Profile $PROFILE failed to respond"
    fi
    echo ""
done

# Determine verdict
echo "=== Panel Summary ==="
echo "Valid judges: $VALID_COUNT / ${#REVIEWER_PROFILES[@]}"
echo "Accept: $ACCEPT_COUNT"
echo "Reject: $REJECT_COUNT"
echo "Closer: $CLOSEST_COUNT"

if [ "$VALID_COUNT" -eq 0 ]; then
    echo "VERDICT=REJECT"
    echo "EXPLANATION=panel too thin (0/3 valid)"
    exit 0
fi

# If panel votes differently, use majority
if [ "$ACCEPT_COUNT" -ge 2 ]; then
    FINAL_VERDICT="ACCEPT"
else
    FINAL_VERDICT="REJECT"
fi

echo "FINAL_VERDICT=$FINAL_VERDICT"
echo "VALID_JUDGES=$VALID_COUNT"
echo "CLOSEST_COUNT=$CLOSEST_COUNT"
echo "TOTAL_CAND_SCORE=$TOTAL_SCORE"
echo "AVG_SCORE=$(echo "scale=2; $TOTAL_SCORE / $VALID_COUNT" | bc)"

exit 0