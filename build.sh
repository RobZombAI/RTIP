#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔨 Building RTIP v2..."

# 1. Build C++ server
echo "  [1/4] Compiling C++ server..."
cd "$DIR/server"
make clean 2>/dev/null
make -j4 2>&1 | grep -v "^$"

# 2. Validate Python workers
echo "  [2/4] Validating Python workers..."
for w in ocr_worker.py timelens_worker.py; do
  python3 -c "import ast; ast.parse(open('$DIR/workers/$w').read())" && echo "    ✅ $w"
done

# 3. Create launcher
echo "  [3/4] Creating launcher..."
LAUNCHER="$DIR/rtip"
cat > "$LAUNCHER" << 'SCRIPT'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$DIR/server/rtip-server"

# Kill any previous instances
for PID in $(pgrep -f "rtip-server" 2>/dev/null); do
  kill -9 $PID 2>/dev/null
done

echo "🚀 Starting RTIP v2..."
echo "   Server:  http://127.0.0.1:8080"
echo "   Log:     $HOME/.rtip.log"
echo "   Cmd+C to stop"

# Start server
"$SERVER"

echo "👋 RTIP stopped"
SCRIPT
chmod +x "$LAUNCHER"

# 4. Install
echo "  [4/4] Installing..."
cp "$LAUNCHER" /usr/local/bin/rtip 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ RTIP v2 built!"
echo ""
echo "  Run:   ./rtip"
echo "  Open:  http://127.0.0.1:8080"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
