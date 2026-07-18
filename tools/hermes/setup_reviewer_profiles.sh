#!/bin/bash
# Setup Reviewer Profiles — Recreate gd-qa-1/2/3 profiles with Ollama config

set -e

HERMES_ROOT="~/.hermes"
DEFAULT_PROFILE="default"

echo "Creating review profiles..."

# Copy default profile as base
if [ ! -d "$HERMES_ROOT/profiles/default" ]; then
    echo "Error: Default profile not found at $HERMES_ROOT/profiles/default"
    exit 1
fi

for PROFILE_NUM in 1 2 3; do
    PROFILE_NAME="gd-qa-$PROFILE_NUM"
    PROFILE_PATH="$HERMES_ROOT/profiles/$PROFILE_NAME"
    
    echo "Creating $PROFILE_NAME..."
    
    # Copy directory
    cp -r "$HERMES_ROOT/profiles/$DEFAULT_PROFILE" "$PROFILE_PATH"
    
    # Override config.yaml with Ollama provider
    cat > "$PROFILE_PATH/config.yaml" <<EOF
# Gate-room hero review profile $PROFILE_NAME
# Uses Ollama Cloud provider

provider: ollama

ollama:
  base_url: https://ollama.com/v1
  api_key: \$OLLAMA_API_KEY  # Set via environment
EOF
    
    echo "Created $PROFILE_NAME profile"
done

echo "Setup complete. Run 'export OLLAMA_API_KEY=your_key' to configure API keys."