#!/bin/bash

# Script to clean up failed renders with permission issues
# Run this script with sudo if frames are owned by root

OUTPUT_DIR="$HOME/cesium-route-renderer/output"

echo "🧹 Cleaning up failed renders..."
echo "Output directory: $OUTPUT_DIR"
echo ""

# Find directories that don't have a route-video.mp4 file (failed renders)
cd "$OUTPUT_DIR" || exit 1

failed_count=0
cleaned_count=0

for dir in render-*; do
  if [ -d "$dir" ]; then
    # Check if video file exists
    if [ ! -f "$dir/route-video.mp4" ]; then
      echo "Found failed render: $dir"
      
      # Check if frames directory exists and has content
      if [ -d "$dir/frames" ] && [ "$(ls -A "$dir/frames" 2>/dev/null)" ]; then
        frame_count=$(ls "$dir/frames" | wc -l)
        frames_size=$(du -sh "$dir/frames" 2>/dev/null | cut -f1)
        echo "  - Has $frame_count frames ($frames_size)"
      fi
      
      # Check for log file
      if [ -f "$dir/recorder.log" ]; then
        log_size=$(wc -l < "$dir/recorder.log")
        echo "  - Has log file ($log_size lines)"
      fi
      
      failed_count=$((failed_count + 1))
      
      # Ask for confirmation
      read -p "  Delete this render? [y/N] " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        if rm -rf "$dir"; then
          echo "  ✅ Deleted successfully"
          cleaned_count=$((cleaned_count + 1))
        else
          echo "  ❌ Failed to delete (try running with sudo)"
        fi
      else
        echo "  ⏭️  Skipped"
      fi
      echo ""
    fi
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary:"
echo "  Failed renders found: $failed_count"
echo "  Cleaned up: $cleaned_count"
echo ""

if [ $failed_count -gt $cleaned_count ]; then
  remaining=$((failed_count - cleaned_count))
  echo "  Remaining: $remaining"
  echo ""
  echo "💡 Tip: If deletion failed due to permissions,"
  echo "   run this script with sudo:"
  echo "   sudo bash $0"
fi
