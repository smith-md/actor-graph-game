#!/bin/bash
# Upload graph data to Cloudflare R2
#
# Prerequisites:
# 1. Install wrangler: npm install -g wrangler
# 2. Login to Cloudflare: wrangler login
# 3. Create R2 bucket: wrangler r2 bucket create cinelinks-graph
#
# Usage: ./scripts/upload-graph-to-r2.sh [graph_version]
# Example: ./scripts/upload-graph-to-r2.sh v20250205

set -e

# Configuration
BUCKET_NAME="cinelinks-graph"
EXPORT_DIR="build/edge_export"

# Get graph version from argument or generate from date
if [ -n "$1" ]; then
    GRAPH_VERSION="$1"
else
    GRAPH_VERSION="v$(date +%Y%m%d)"
fi

echo "=== CineLinks Graph Upload to R2 ==="
echo "Bucket: $BUCKET_NAME"
echo "Graph Version: $GRAPH_VERSION"
echo "Source: $EXPORT_DIR"
echo ""

# Check if export directory exists
if [ ! -d "$EXPORT_DIR" ]; then
    echo "Error: Export directory not found at $EXPORT_DIR"
    echo "Run 'python build/export_graph_for_edge.py' first to generate the edge data."
    exit 1
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Error: wrangler CLI not found"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

# Upload metadata files
echo "Uploading metadata files..."
for file in "$EXPORT_DIR/metadata"/*.json; do
    filename=$(basename "$file")
    key="graph/$GRAPH_VERSION/metadata/$filename"
    echo "  $key"
    wrangler r2 object put "$BUCKET_NAME/$key" --file "$file" --content-type "application/json"
done

# Upload neighbor files
echo ""
echo "Uploading neighbor files..."
total_files=$(ls -1 "$EXPORT_DIR/neighbors"/*.json 2>/dev/null | wc -l)
current=0

for file in "$EXPORT_DIR/neighbors"/*.json; do
    filename=$(basename "$file")
    key="graph/$GRAPH_VERSION/neighbors/$filename"
    wrangler r2 object put "$BUCKET_NAME/$key" --file "$file" --content-type "application/json"

    current=$((current + 1))
    if [ $((current % 100)) -eq 0 ]; then
        echo "  Progress: $current / $total_files files uploaded"
    fi
done

echo ""
echo "=== Upload Complete ==="
echo "Total files uploaded: $current neighbor files + metadata"
echo ""
echo "Next steps:"
echo "1. Update workers/wrangler.toml to set GRAPH_VERSION = \"$GRAPH_VERSION\""
echo "2. Deploy workers: cd workers && npm run deploy"
echo "3. Update frontend VITE_API_URL to point to the Workers URL"
