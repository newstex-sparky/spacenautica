#!/bin/bash

# Spacenautica Visual Test Script
# Tests all visual elements including M2 Station Builder

echo "===================================="
echo "SPACENAUTICA VISUAL TEST SUITE"
echo "===================================="
echo ""

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"

    echo -e "${BLUE}[TEST]${NC} $test_name"

    if eval "$test_command"; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((TESTS_FAILED++))
    fi
    echo ""
}

# Test 1: Server is running
echo "===================================="
echo "SERVER HEALTH CHECK"
echo "===================================="
run_test "HTTP Server Responding" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/index.html | grep -q '200'"

# Test 2: File exists and has correct size
echo "===================================="
echo "FILE INTEGRITY"
echo "===================================="
run_test "index.html exists" "[ -f index.html ]"
run_test "index.html has content" "[ $(wc -c < index.html) -gt 10000 ]"
run_test "index.html has correct size (20KB+)" "[ $(wc -c < index.html) -gt 20000 ]"

# Test 3: HTML Structure
echo "===================================="
echo "HTML STRUCTURE"
echo "===================================="
run_test "Station builder menu exists" "grep -q 'station-builder-menu' index.html"
run_test "CSS styles added" "grep -q 'STATION BUILDER STYLES' index.html"
run_test "Station builder JavaScript" "grep -q 'M2 STATION BUILDING SYSTEM' index.html"

# Test 4: UI Elements
echo "===================================="
echo "UI ELEMENTS"
echo "===================================="
run_test "Module buttons present" "grep -q 'module-select-btn' index.html"
run_test "Cost display exists" "grep -q 'cost-text' index.html"
run_test "Feedback panel exists" "grep -q 'placement-feedback' index.html"
run_test "Stats display (Iron/Ice)" "grep -q 'iron-display' index.html"

# Test 5: Module Types
echo "===================================="
echo "MODULE CONFIGURATION"
echo "===================================="
run_test "Habitat module defined" "grep -q 'habitat.*name.*Habitat' index.html"
run_test "Smelter module defined" "grep -q 'smelter.*name.*Smelter' index.html"
run_test "Refinery module defined" "grep -q 'refinery.*name.*Refinery' index.html"
run_test "Solar panel module" "grep -q 'solar.*name.*Solar' index.html"
run_test "O2 generator module" "grep -q 'o2gen.*name.*O2' index.html"
run_test "Comms array module" "grep -q 'comms.*name.*Comms' index.html"

# Test 6: JavaScript Functions
echo "===================================="
echo "JAVASCRIPT FUNCTIONS"
echo "===================================="
run_test "toggleBuilder function" "grep -q 'function toggleBuilder()' index.html"
run_test "selectModule function" "grep -q 'function selectModule()' index.html"
run_test "placeModule function" "grep -q 'function placeModule()' index.html"
run_test "placeStructure function" "grep -q 'function placeStructure()' index.html"
run_test "isValidPlacement function" "grep -q 'function isValidPlacement()' index.html"
run_test "checkResources function" "grep -q 'function checkResources()' index.html"
run_test "initStationBuilder function" "grep -q 'function initStationBuilder()' index.html"

# Test 7: CSS Styling
echo "===================================="
echo "CSS STYLING"
echo "===================================="
run_test "Builder container styles" "grep -q 'station-builder-container' index.html"
run_test "Module button styles" "grep -q 'module-select-btn' index.html"
run_test "Action button styles" "grep -q 'action-btn' index.html"
run_test "Holographic effects" "grep -q 'backdrop-filter.*blur' index.html"
run_test "Feedback styles" "grep -q '#placement-feedback' index.html"

# Test 8: Module Colors
echo "===================================="
echo "MODULE CONFIGURATION"
echo "===================================="
run_test "Habitat color (Blue)" "grep -q '0x4FACFE.*habitat' index.html"
run_test "Smelter color (Orange)" "grep -q '0xFFA500.*smelter' index.html"
run_test "Refinery color (Cyan)" "grep -q '0x4F86F7.*refinery' index.html"
run_test "Solar color (Yellow)" "grep -q '0xFFFF00.*solar' index.html"
run_test "O2 generator color (Green)" "grep -q '0x4CAF50.*o2gen' index.html"
run_test "Comms color (Red)" "grep -q '0xFF4F4F.*comms' index.html"

# Test 9: Keyboard Controls
echo "===================================="
echo "KEYBOARD CONTROLS"
echo "===================================="
run_test "B key toggle" "grep -q \"e.code === 'KeyB'\" index.html"
run_test "ESC key exit" "grep -q \"e.code === 'Escape'\" index.html"
run_test "1-6 number keys" "grep -q \"Digit1.*habitat.*Digit6.*comms\" index.html"
run_test "WASD movement" "grep -q \"keys\['KeyW'\].*keys\['KeyS'\].*keys\['KeyA'\].*keys\['KeyD'\" index.html"

# Test 10: Grid System
echo "===================================="
echo "GRID SYSTEM CONFIGURATION"
echo "===================================="
run_test "GRID_SIZE constant" "grep -q \"const GRID_SIZE = 10\" index.html"
run_test "GRID_SPACING constant" "grep -q \"const GRID_SPACING = 5\" index.html"

# Test 11: Module Costs
echo "===================================="
echo "MODULE COSTS"
echo "===================================="
run_test "Habitat cost: 50 Iron, 30 Ice" "grep -q \"cost:.*iron.*50.*ice.*30.*habitat\" index.html"
run_test "Smelter cost: 40 Iron, 20 Ice" "grep -q \"cost:.*iron.*40.*ice.*20.*smelter\" index.html"
run_test "Refinery cost: 50 Ice" "grep -q \"cost:.*ice.*50.*refinery\" index.html"
run_test "Solar cost: 30 Iron" "grep -q \"cost:.*iron.*30.*solar\" index.html"
run_test "O2 generator cost: 40 Ice" "grep -q \"cost:.*ice.*40.*o2gen\" index.html"
run_test "Comms cost: 60 Iron, 40 Ice" "grep -q \"cost:.*iron.*60.*ice.*40.*comms\" index.html"

# Test 12: Ghost Module
echo "===================================="
echo "GHOST MODULE PREVIEW"
echo "===================================="
run_test "Ghost module created" "grep -q 'ghostMesh' index.html"
run_test "Ghost material with transparency" "grep -q 'transparent.*true.*opacity.*0.3' index.html"
run_test "Wireframe edges for visibility" "grep -q 'EdgesGeometry' index.html"

# Test 13: Resource Validation
echo "===================================="
echo "RESOURCE VALIDATION"
echo "===================================="
run_test "Iron cost checking" "grep -q \"gameState.iron -=\" index.html"
run_test "Ice cost checking" "grep -q \"gameState.ice -=\" index.html"

# Test 14: Placement Feedback
echo "===================================="
echo "PLACEMENT FEEDBACK"
echo "===================================="
run_test "Feedback display" "grep -q 'showPlacementFeedback' index.html"
run_test "Valid placement indicator" "grep -q '✓ Valid Placement' index.html"
run_test "Invalid placement message" "grep -q '✗ Cannot Place Here' index.html"

# Test 15: Minimap/Status Update
echo "===================================="
echo "STATUS UPDATES"
echo "===================================="
run_test "Iron display element" "grep -q 'iron-display' index.html"
run_test "Ice display element" "grep -q 'ice-display' index.html"
run_test "Update loop integration" "grep -q 'updateBuilder.*deltaTime' index.html"

# Test 16: Document Files
echo "===================================="
echo "DOCUMENTATION"
echo "===================================="
run_test "IMPLEMENTATION_M2.md exists" "[ -f IMPLEMENTATION_M2.md ]"
run_test "IMPLEMENTATION_M2.md has content" "[ $(wc -c < IMPLEMENTATION_M2.md) -gt 10000 ]"

# Summary
echo "===================================="
echo "TEST SUMMARY"
echo "===================================="
echo -e "Total Tests: $((TESTS_PASSED + TESTS_FAILED))"
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

# Calculate percentage
if [ $((TESTS_PASSED + TESTS_FAILED)) -gt 0 ]; then
    PERCENTAGE=$((TESTS_PASSED * 100 / (TESTS_PASSED + TESTS_FAILED)))
    echo -e "Success Rate: ${PERCENTAGE}%"
else
    echo "Success Rate: N/A"
fi

echo ""

# Return exit code
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi