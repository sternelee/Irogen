#!/bin/sh
# ClawdPilot CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/sternelee/ClawdPilot/main/install.sh | sh

set -e

# Configuration
REPO="sternelee/ClawdPilot"
BINARY_NAME="clawdpilot_cli"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${HOME}/.config/clawdpilot"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

log_warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

log_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux*)
            PLATFORM="linux"
            ;;
        Darwin*)
            PLATFORM="darwin"
            ;;
        *)
            log_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac

    case "$ARCH" in
        x86_64|amd64)
            ARCH_NAME="amd64"
            ;;
        aarch64|arm64)
            ARCH_NAME="arm64"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    EXTENSION="tar.gz"
    if [ "$PLATFORM" = "windows" ]; then
        EXTENSION="zip"
    fi

    FILENAME="${BINARY_NAME}-${PLATFORM}-${ARCH_NAME}.${EXTENSION}"
    log_info "Detected platform: $PLATFORM-$ARCH_NAME"
}

# Get latest release version
get_latest_version() {
    VERSION=$(curl -sL https://api.github.com/repos/${REPO}/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | cut -c2-)
    if [ -z "$VERSION" ]; then
        log_error "Failed to get latest version"
        exit 1
    fi
    log_info "Latest version: $VERSION"
}

# Download and extract
download_and_install() {
    log_info "Downloading ${FILENAME}..."
    URL="https://github.com/${REPO}/releases/download/${VERSION}/${FILENAME}"

    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"

    # Download with retry
    if ! curl -fSL "$URL" -o "${TEMP_DIR}/${FILENAME}"; then
        log_error "Failed to download from $URL"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    log_info "Extracting..."
    if [ "$EXTENSION" = "tar.gz" ]; then
        tar -xzf "$FILENAME"
    elif [ "$EXTENSION" = "zip" ]; then
        unzip -o "$FILENAME"
    fi

    # Find the binary
    BINARY=$(find . -type f -name "${BINARY_NAME}*" ! -name "*.tar.gz" ! -name "*.zip" ! -name "*.*" | head -n1)

    if [ -z "$BINARY" ]; then
        # Try with .exe on Windows
        BINARY=$(find . -type f -name "${BINARY_NAME}*.exe" | head -n1)
    fi

    if [ -z "$BINARY" ]; then
        log_error "Binary not found in archive"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    log_info "Installing to ${INSTALL_DIR}..."

    # Create install directory if needed
    mkdir -p "$INSTALL_DIR"

    # Install binary
    cp "$BINARY" "${INSTALL_DIR}/clawdpilot"
    chmod +x "${INSTALL_DIR}/clawdpilot"

    # Create config directory
    mkdir -p "$CONFIG_DIR"

    # Cleanup
    cd /
    rm -rf "$TEMP_DIR"

    log_info "Installed successfully!"
}

# Verify installation
verify_installation() {
    if [ -x "${INSTALL_DIR}/clawdpilot" ]; then
        log_info "Verification: ${INSTALL_DIR}/clawdpilot"
        "${INSTALL_DIR}/clawdpilot" --version || true
    else
        log_error "Installation verification failed"
        exit 1
    fi
}

# Main
main() {
    log_info "ClawdPilot CLI Installer"
    echo ""

    detect_platform
    get_latest_version
    download_and_install
    verify_installation

    echo ""
    log_info "Installation complete!"
    log_info "Add ${INSTALL_DIR} to your PATH if needed."
    log_info "Run 'clawdpilot host' to start the CLI server."
}

main "$@"
