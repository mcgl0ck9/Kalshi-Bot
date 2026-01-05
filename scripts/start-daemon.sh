#!/bin/bash
#
# Kalshi Edge Detector - Daemon Management Script
#
# Usage:
#   ./scripts/start-daemon.sh [start|stop|restart|status|logs]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if PM2 is installed
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        echo -e "${RED}Error: PM2 is not installed${NC}"
        echo "Install it with: npm install -g pm2"
        exit 1
    fi
}

# Build the project if needed
build_if_needed() {
    if [ ! -d "dist" ] || [ "$(find src -name '*.ts' -newer dist/index.js 2>/dev/null | head -1)" ]; then
        echo -e "${YELLOW}Building project...${NC}"
        npm run build
    fi
}

# Start the daemon
start() {
    check_pm2
    build_if_needed

    echo -e "${GREEN}Starting Kalshi Edge Detector daemon...${NC}"
    pm2 start ecosystem.config.js

    echo -e "${GREEN}Daemon started successfully!${NC}"
    echo ""
    pm2 status
}

# Stop the daemon
stop() {
    check_pm2

    echo -e "${YELLOW}Stopping Kalshi Edge Detector daemon...${NC}"
    pm2 stop ecosystem.config.js

    echo -e "${GREEN}Daemon stopped.${NC}"
}

# Restart the daemon
restart() {
    check_pm2
    build_if_needed

    echo -e "${YELLOW}Restarting Kalshi Edge Detector daemon...${NC}"
    pm2 restart ecosystem.config.js

    echo -e "${GREEN}Daemon restarted.${NC}"
    echo ""
    pm2 status
}

# Show status
status() {
    check_pm2

    echo -e "${BLUE}Kalshi Edge Detector Status:${NC}"
    echo ""
    pm2 status
}

# Show logs
logs() {
    check_pm2

    echo -e "${BLUE}Kalshi Edge Detector Logs:${NC}"
    pm2 logs kalshi-bot --lines 100
}

# Monitor processes
monitor() {
    check_pm2

    echo -e "${BLUE}Opening PM2 Monitor...${NC}"
    pm2 monit
}

# Setup auto-start on boot
setup_autostart() {
    check_pm2

    echo -e "${YELLOW}Setting up auto-start on system boot...${NC}"
    pm2 startup
    pm2 save

    echo -e "${GREEN}Auto-start configured. Daemon will start on system boot.${NC}"
}

# Show help
show_help() {
    echo "Kalshi Edge Detector - Daemon Management"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start       Start the daemon"
    echo "  stop        Stop the daemon"
    echo "  restart     Restart the daemon"
    echo "  status      Show daemon status"
    echo "  logs        Show recent logs"
    echo "  monitor     Open PM2 monitor (interactive)"
    echo "  autostart   Setup auto-start on system boot"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start    # Start the daemon"
    echo "  $0 logs     # View logs"
    echo "  $0 status   # Check status"
}

# Main
case "${1:-help}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    monitor)
        monitor
        ;;
    autostart)
        setup_autostart
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
