#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/RTIP.app"
SOURCES="$DIR/sources"
VENV="/Users/robzomb/qwen3-tts-ui/venv"

echo "🔨 Building RTIP.app..."

rm -rf "$APP" 2>/dev/null
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Launcher — venv with pywebview + port cleanup
cat > "$APP/Contents/MacOS/RTIP" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOGFILE="$HOME/.rtip.log"
VENV="/Users/robzomb/qwen3-tts-ui/venv"
export PATH="$VENV/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
unset PYTHONHOME PYTHONPATH

echo "[$(date)] Starting RTIP..." > "$LOGFILE"

# Kill any leftover python processes holding pywebview ports
for port in 8125 8126 8127 8128; do
  PID=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$PID" ]; then
    kill -9 $PID 2>/dev/null
    echo "[$(date)] Freed port $port (PID $PID)" >> "$LOGFILE"
  fi
done

echo "[$(date)] Python: $VENV/bin/python3" >> "$LOGFILE"
exec "$VENV/bin/python3" -u "$DIR/Resources/main.py" >> "$LOGFILE" 2>&1
LAUNCHER
chmod +x "$APP/Contents/MacOS/RTIP"

# Plist
cat > "$APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>RTIP</string>
    <key>CFBundleIdentifier</key>
    <string>com.rtip.app</string>
    <key>CFBundleName</key>
    <string>RTIP</string>
    <key>CFBundleDisplayName</key>
    <string>RTIP — ReadingTextImgPdf</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST
echo "APPL????" > "$APP/Contents/PkgInfo"

# Source files
cp "$SOURCES/main.py" "$APP/Contents/Resources/main.py"
cp "$SOURCES/lighton_ocr.py" "$APP/Contents/Resources/lighton_ocr.py"
cp "$SOURCES/resources/index.html" "$APP/Contents/Resources/index.html"
cp "$SOURCES/resources/api.js" "$APP/Contents/Resources/api.js"

# Validate
python3 -c "import ast; ast.parse(open('$APP/Contents/Resources/main.py').read()); print('✅ main.py OK')"
python3 -c "import ast; ast.parse(open('$APP/Contents/Resources/lighton_ocr.py').read()); print('✅ lighton_ocr.py OK')"
echo "✅ Built: $(wc -c < $APP/Contents/Resources/api.js) bytes JS · $(wc -c < $APP/Contents/Resources/index.html) bytes HTML"

# Install
rm -rf "$HOME/Applications/RTIP.app" 2>/dev/null
cp -R "$APP" "$HOME/Applications/RTIP.app"
echo "✅ Installed: ~/Applications/RTIP.app"
echo "📦 Size: $(du -sh $APP | cut -f1)"
echo ""
echo "🚀 Open with: open ~/Applications/RTIP.app"